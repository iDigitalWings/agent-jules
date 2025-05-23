# agent_backend/tests/test_agent.py
import unittest
import asyncio
import os
import json
from unittest.mock import patch, MagicMock, AsyncMock

# Standard project structure: tests/ is sibling to app/ and tools/
# Ensure agent_backend (parent of app, tools, tests) is in PYTHONPATH
import sys
project_root_for_tests = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if project_root_for_tests not in sys.path:
    sys.path.insert(0, project_root_for_tests)

from app.agent import Agent 
# We need to be able to mock these tool classes if Agent instantiates them directly.
# Or, if Agent takes them as dependencies, we can pass mocks.
# Current Agent instantiates them, so we'll mock where they are imported by 'app.agent' or mock their instances.
from tools.extract_order_details import ExtractOrderDetailsTool
from tools.query_order_status import QueryOrderStatusTool
from tools.handle_order_exception import HandleOrderExceptionTool


def async_test(f):
    def wrapper(*args, **kwargs):
        asyncio.run(f(*args, **kwargs))
    return wrapper

class TestAgentLogic(unittest.TestCase):

    def setUp(self):
        self.env_path = os.path.join(project_root_for_tests, '.env')
        original_env_content = None
        if os.path.exists(self.env_path):
            with open(self.env_path, "r") as f:
                original_env_content = f.read()
        
        # Ensure a .env file exists with a dummy key for consistent test setup
        # This helps if Agent's __init__ or its module load_dotenv directly.
        with open(self.env_path, "w") as f:
            f.write("OPENAI_API_KEY=\"dummy_api_key_for_testing\"\n") # Corrected syntax

        self.original_env_content = original_env_content # Store to restore later

        # Patch os.getenv specifically for OPENAI_API_KEY to control agent's client creation for some tests
        self.getenv_patcher = patch('app.agent.os.getenv')
        self.mock_getenv = self.getenv_patcher.start()
        self.mock_getenv.side_effect = lambda key, default=None: "dummy_api_key_for_testing" if key == "OPENAI_API_KEY" else os.environ.get(key, default)


        # Patch the OpenAI client that the Agent class instantiates
        self.openai_client_patcher = patch('app.agent.OpenAI', spec=True)
        self.MockOpenAI = self.openai_client_patcher.start()
        self.mock_openai_instance = self.MockOpenAI.return_value
        self.mock_openai_instance.chat.completions.create = AsyncMock()

        # Patch the tool instantiations within the Agent or the tool modules themselves if necessary
        # For simplicity, we'll mock the instances on the Agent after it's created.
        self.agent = Agent() # Agent uses mocked OpenAI due to above patch
        
        # Replace tool instances on the agent with AsyncMocks
        self.agent.tools['extract_order_details'] = AsyncMock(spec=ExtractOrderDetailsTool)
        self.agent.tools['query_order_status'] = AsyncMock(spec=QueryOrderStatusTool)
        self.agent.tools['handle_order_exception'] = AsyncMock(spec=HandleOrderExceptionTool)


    def tearDown(self):
        self.openai_client_patcher.stop()
        self.getenv_patcher.stop()
        # Restore original .env content if it existed
        if self.original_env_content is not None:
            with open(self.env_path, "w") as f:
                f.write(self.original_env_content)
        elif os.path.exists(self.env_path): # If test created it and it wasn't there before
            # Check if it's the one we wrote, then remove (optional, for cleanup)
            with open(self.env_path, "r") as f:
                content = f.read()
            if "dummy_api_key_for_testing" in content:
                 os.remove(self.env_path)


    def _configure_llm_decision(self, action, reasoning="Test reasoning"):
        decision_response_content = json.dumps({"action": action, "reasoning": reasoning})
        # This mock will be used by _get_llm_decision
        self.mock_openai_instance.chat.completions.create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=decision_response_content))]
        )
        
    def _configure_llm_direct_fallback_response(self, text_response="Test direct fallback response."):
        # This mock will be used by the final fallback LLM call in process_request
        # Need to ensure it's configured for the right call if multiple LLM calls happen.
        # Using side_effect is good for this.
        # For now, assume it's the next call after a decision if no tools fully handle.
        direct_response_mock = MagicMock(
            choices=[MagicMock(message=MagicMock(content=text_response))]
        )
        # If _get_llm_decision was called, its return value is already set.
        # If a second call is made (the fallback), this will be its return value.
        self.mock_openai_instance.chat.completions.create.side_effect = [
            self.mock_openai_instance.chat.completions.create.return_value, # First call (decision)
            direct_response_mock # Second call (fallback)
        ]


    @async_test
    async def test_extract_details_success_then_query_success(self):
        user_query = "My order is 123, type electronics"
        self._configure_llm_decision("EXTRACT_DETAILS")
        
        self.agent.tools['extract_order_details'].extract.return_value = {
            "order_number": "123", "order_type": "electronics", "status_message": "Details extracted."}
        self.agent.tools['query_order_status'].query.return_value = {
            "status": "success", "order_number": "123", "order_type": "electronics",
            "order_status_from_backend": "Shipped", "data": {"tracking": "XYZ"}}

        response = await self.agent.process_request(user_query)
        
        self.agent.tools['extract_order_details'].extract.assert_called_once_with(user_query)
        self.agent.tools['query_order_status'].query.assert_called_once_with("123", "electronics")
        self.assertIn("Shipped", response["response"])
        self.assertEqual(self.agent.conversation_context["order_number"], "123")

    @async_test
    async def test_extract_details_need_type_prompts_user(self):
        user_query = "Order number is 456"
        self._configure_llm_decision("EXTRACT_DETAILS")
        self.agent.tools['extract_order_details'].extract.return_value = {
            "order_number": "456", "order_type": None, "status_message": "Order type is missing."}

        response = await self.agent.process_request(user_query)
        
        self.agent.tools['extract_order_details'].extract.assert_called_once_with(user_query)
        self.agent.tools['query_order_status'].query.assert_not_called()
        self.assertIn("Order type is missing.", response["response"])
        self.assertIn("Please provide the missing information: Order Type.", response["response"])

    @async_test
    async def test_query_status_error_then_handle_exception(self):
        user_query = "Check order 789, type books"
        # Pre-populate context as if details were known
        self.agent.conversation_context = {"order_number": "789", "order_type": "books"}
        self._configure_llm_decision("QUERY_STATUS") # LLM Decides to query (or rule-based if LLM mocked that way)

        query_error_output = {"status": "error", "error_type": "simulated_backend_error", "message": "Simulated error"}
        self.agent.tools['query_order_status'].query.return_value = query_error_output
        
        exception_tool_response = {"user_message": "Backend error. Try later.", "suggested_actions": ["Retry"]}
        self.agent.tools['handle_order_exception'].handle.return_value = exception_tool_response

        response = await self.agent.process_request(user_query)

        self.agent.tools['query_order_status'].query.assert_called_once_with("789", "books")
        self.agent.tools['handle_order_exception'].handle.assert_called_once_with("789", "books", query_error_output)
        self.assertIn("Backend error. Try later.", response["response"])

    @async_test
    async def test_direct_response_from_llm(self):
        user_query = "Hello"
        # LLM decides to respond directly (first LLM call in process_request)
        self._configure_llm_decision("RESPOND_DIRECTLY", "User greeted, respond politely.")
        # Agent's process_request will then make a second LLM call for the actual response content
        self._configure_llm_direct_fallback_response("Hello to you too!")


        response = await self.agent.process_request(user_query)
        
        self.agent.tools['extract_order_details'].extract.assert_not_called()
        self.agent.tools['query_order_status'].query.assert_not_called()
        self.agent.tools['handle_order_exception'].handle.assert_not_called()
        self.assertEqual(response["response"], "Hello to you too!")
        # Check that the decision-making LLM call was made, and then the response-generating LLM call.
        self.assertEqual(self.mock_openai_instance.chat.completions.create.call_count, 2)


    @async_test
    async def test_agent_behavior_with_no_real_api_key(self):
        # This test ensures that if OPENAI_API_KEY is "dummy..." or None,
        # the agent responds with an error before trying to call LLM.
        self.mock_getenv.side_effect = lambda key, default=None: "dummy_key_for_subtask_environment" if key == "OPENAI_API_KEY" else os.environ.get(key, default)
        
        # Re-initialize agent: it should now have self.client = None or a client that won't work
        # The Agent's __init__ has logic for this. Let's re-initialize to test that path.
        # The MockOpenAI is still in place, but agent.client might be None internally if key is bad.
        # For this specific test, we want to test the Agent's internal check for the key.
        
        # To truly test the Agent's __init__ path for NO key, we need to bypass class-level mock_getenv for a moment
        self.getenv_patcher.stop() # Stop the general mock
        no_key_getenv_patcher = patch('app.agent.os.getenv', return_value=None) # Simulate no key at all
        mock_no_key_getenv = no_key_getenv_patcher.start()

        agent_no_key = Agent() # This agent will have self.client = None
        
        mock_no_key_getenv.stop() # Stop this specific patch
        self.getenv_patcher.start() # Restart general patch for other tests if any in future in this class

        self.assertIsNone(agent_no_key.client) # Client should be None
            
        user_query = "Check order 123"
        # process_request should catch that client is None
        response = await agent_no_key.process_request(user_query)
            
        self.assertIn("error", response)
        self.assertIn("OpenAI API key missing or dummy", response["error"])
        self.mock_openai_instance.chat.completions.create.assert_not_called() # Crucially, no LLM call attempted


if __name__ == "__main__":
    unittest.main()
