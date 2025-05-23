import os
from openai import OpenAI
from dotenv import load_dotenv
import json
import sys
import asyncio # Make sure asyncio is imported

# Add project root to sys.path to allow importing tools
# Assumes agent.py is in agent_backend/app/
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

# Tool Imports
try:
    from tools.extract_order_details import ExtractOrderDetailsTool
    from tools.query_order_status import QueryOrderStatusTool
    from tools.handle_order_exception import HandleOrderExceptionTool
except ImportError as e:
    # Using print for critical import errors as logger might not be configured yet if agent is imported elsewhere.
    print(f"CRITICAL: Error importing tools in agent.py: {e}. This might be due to missing __init__.py in 'tools' or incorrect PYTHONPATH.")
    print(f"CRITICAL: Current sys.path: {sys.path}")
    # Define dummy classes if import fails, so agent can be instantiated for basic checks
    class ExtractOrderDetailsTool:
        async def extract(self, *args, **kwargs): return {"error": "Tool 'ExtractOrderDetailsTool' not loaded", "status_message": "Cannot extract details."}
    class QueryOrderStatusTool:
        async def query(self, *args, **kwargs): return {"error": "Tool 'QueryOrderStatusTool' not loaded", "status": "error", "message": "Cannot query status."}
    class HandleOrderExceptionTool:
        async def handle(self, *args, **kwargs): return {"error": "Tool 'HandleOrderExceptionTool' not loaded", "user_message": "Cannot handle exception."}

# Load .env from agent_backend directory (parent of app)
# The Agent class is in app/agent.py, so .env should be in the directory above app/
dotenv_main_path = os.path.join(os.path.dirname(__file__), '..', '.env')
load_dotenv(dotenv_path=dotenv_main_path)


class Agent:
    def __init__(self, model_name="gpt-3.5-turbo"):
        self.api_key = os.getenv("OPENAI_API_KEY")
        if not self.api_key or self.api_key == "dummy_key_for_subtask_environment":
            # This print is for console visibility during startup or direct testing.
            # The main app logger will also catch issues if agent init fails there.
            print("ERROR: OPENAI_API_KEY not found or is a dummy key. Agent's LLM dependent features will be impaired.")
            self.client = None
        else:
            self.client = OpenAI(api_key=self.api_key)
        
        self.model_name = model_name
        self.history = [] 
        self.tools = {
            "extract_order_details": ExtractOrderDetailsTool(),
            "query_order_status": QueryOrderStatusTool(),
            "handle_order_exception": HandleOrderExceptionTool(),
        }
        self.conversation_context = {} # Stores transient data for the current conversation

    def _add_to_history(self, role: str, content: str):
        # Ensure content is a string, as LLM expects string messages.
        # Tool outputs might be dicts, so we stringify them for history if needed,
        # or summarize them. For now, primary tool outputs are summarized by the agent logic itself.
        if not isinstance(content, str):
            content_str = json.dumps(content) # Basic stringification for non-string content
        else:
            content_str = content
        self.history.append({"role": role, "content": content_str})

    async def _get_llm_decision(self, current_query: str):
        if not self.client:
            # Fallback decision if LLM is not available
            print("ERROR: LLM client not available (API key likely missing or dummy). Attempting rule-based action determination.")
            if "order number" in current_query.lower() or "order id" in current_query.lower() or \
               (self.conversation_context.get("order_number") and not self.conversation_context.get("order_type")):
                return {"action": "EXTRACT_DETAILS", "reasoning": "Rule-based: Query likely contains or needs order details."}
            if self.conversation_context.get("order_number") and self.conversation_context.get("order_type"):
                return {"action": "QUERY_STATUS", "reasoning": "Rule-based: Order details known, try querying status."}
            return {"action": "RESPOND_DIRECTLY", "reasoning": "Rule-based: Default to direct response or clarification."}

        system_prompt = f"""
        You are an AI assistant helping with order inquiries. Your goal is to guide the user through checking their order.
        Conversation History (last 5 exchanges):
        {json.dumps(self.history[-5:], indent=2)} 
        
        Current User Query: "{current_query}"
        
        Current known context about the order (if any): {json.dumps(self.conversation_context)}

        Based ONLY on the Current User Query and Current known context, decide the single best immediate action:
        1. "EXTRACT_DETAILS": If the query provides new order information (number or type) OR if order number/type is clearly missing and needed.
        2. "QUERY_STATUS": If sufficient order number AND type are ALREADY in the 'Current known context' AND the user wants to know the status.
        3. "HANDLE_EXCEPTION": If 'Current known context' contains 'last_error_details' indicating a problem with a previous query.
        4. "RESPOND_DIRECTLY": For greetings, general questions, or if you need to ask for clarification before any other action. DO NOT choose this if details are present and status is desired.

        Respond with a JSON object: {{"action": "CHOSEN_ACTION", "reasoning": "Your brief reasoning."}}
        Example if user says "My order 123 type electronics": {{"action": "EXTRACT_DETAILS", "reasoning": "User provided order number and type."}}
        Example if context has order number & type and user says "what's its status?": {{"action": "QUERY_STATUS", "reasoning": "Context has details, user wants status."}}
        Example if context has last_error_details: {{"action": "HANDLE_EXCEPTION", "reasoning": "Previous query failed."}}
        """
        try:
            response = self.client.chat.completions.create(
                model=self.model_name, # Ensure this model supports JSON mode if using response_format
                messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": current_query}], # Pass current_query as user message to system prompt
                response_format={"type": "json_object"}
            )
            decision_str = response.choices[0].message.content
            return json.loads(decision_str)
        except Exception as e:
            # This print will be visible if agent is tested directly. App logger will catch errors from process_request.
            print(f"ERROR: Error getting LLM decision: {e}. Falling back to direct response.")
            return {"action": "RESPOND_DIRECTLY", "reasoning": f"Error in LLM decision making: {str(e)}"}

    async def process_request(self, user_query: str):
        self._add_to_history("user", user_query)

        # This check is crucial for graceful degradation if API key is missing/dummy
        if not self.client: # self.client is None if key was missing/dummy at init
            no_key_message = "I'm currently unable to connect to my core services due to a configuration issue (API key). Please try again later or contact support."
            self._add_to_history("assistant", no_key_message)
            # This error message will be picked up by main.py's logger and returned as HTTPException
            return {"response": no_key_message, "context": self.conversation_context, "error": "OpenAI API key missing or dummy."}

        # 1. LLM decides on an action
        decision_result = await self._get_llm_decision(user_query)
        action = decision_result.get("action")
        # This print is for agent-level debugging, not primary app logging
        print(f"INFO: LLM/Rule-based Decision: {action}, Reasoning: {decision_result.get('reasoning')}")

        # 2. Execute action
        if action == "EXTRACT_DETAILS":
            # Pass only the current user_query to extract tool, as history is for the LLM's broader context
            tool_output = await self.tools["extract_order_details"].extract(user_query) 
            
            if tool_output.get("error"):
                # If the tool itself errors (e.g. "Tool not loaded"), this needs to be handled.
                # The current structure means this error is from the tool's execution logic (e.g. OpenAI call within tool failed)
                # or if a dummy tool (due to import error) was called.
                response_message = f"I encountered an issue while trying to process the order details. ({tool_output.get('status_message', tool_output.get('error', 'Internal tool error'))}). Could you please try stating the order number and type clearly?"
                self._add_to_history("assistant", response_message)
                # This response is okay, but the FastAPI endpoint should probably return a 500 if "Tool ... not loaded"
                # For now, this error is passed to the client as part of the response message.
                # The main.py handler will turn this into an HTTPException if "error" key is still present at the end.
                # Let's ensure the "error" key from tool_output is propagated if it's critical.
                final_response = {"response": response_message, "context": self.conversation_context}
                if "Tool 'ExtractOrderDetailsTool' not loaded" in tool_output.get("error",""): # Critical internal error
                    final_response["error"] = tool_output.get("error")
                return final_response


            # Update context from tool output
            if tool_output.get("order_number"):
                self.conversation_context["order_number"] = tool_output.get("order_number")
            if tool_output.get("order_type"):
                self.conversation_context["order_type"] = tool_output.get("order_type")
            
            status_message = tool_output.get("status_message", "Details processed.")
            # The agent informs based on current context after extraction
            if self.conversation_context.get("order_number") and self.conversation_context.get("order_type"):
                response_message = f"Okay, I have your order number as {self.conversation_context['order_number']} and type as {self.conversation_context['order_type']}. Let me check the status now."
                self._add_to_history("assistant", response_message)
                action = "QUERY_STATUS" # Transition to query status
            else:
                response_message = status_message + " Please provide the missing information: "
                if not self.conversation_context.get("order_number"): response_message += "Order Number. "
                if not self.conversation_context.get("order_type"): response_message += "Order Type."
                self._add_to_history("assistant", response_message)
                return {"response": response_message, "context": self.conversation_context}

        if action == "QUERY_STATUS":
            order_num = self.conversation_context.get("order_number")
            order_type = self.conversation_context.get("order_type")

            if not order_num or not order_type:
                missing_info_msg = "I need both the order number and type to check the status. "
                if not order_num: missing_info_msg += "What is the order number? "
                if not order_type: missing_info_msg += "What is the order type? "
                self._add_to_history("assistant", missing_info_msg)
                return {"response": missing_info_msg, "context": self.conversation_context}

            tool_output = await self.tools["query_order_status"].query(order_num, order_type)
            
            if tool_output.get("error") and "Tool 'QueryOrderStatusTool' not loaded" in tool_output.get("error",""):
                 # Critical internal error if a dummy tool was called
                response_message = "I'm currently unable to query order status due to an internal issue. Please try again later."
                self._add_to_history("assistant", response_message)
                return {"response": response_message, "error": tool_output.get("error"), "context": self.conversation_context}

            if tool_output.get("status") == "success":
                response_message = f"Order {order_num} ({order_type}): Status is '{tool_output.get('order_status_from_backend')}'."
                if tool_output.get("data"):
                    response_message += f" Additional details: {json.dumps(tool_output.get('data'))}"
                self._add_to_history("assistant", response_message)
                # Clear error context if query is successful
                if "last_error_details" in self.conversation_context:
                    del self.conversation_context["last_error_details"]
                return {"response": response_message, "data": tool_output, "context": self.conversation_context}
            else: 
                # This 'else' implies status is not "success". It could be "error", "not_found", etc.
                # These are conditions that HandleOrderExceptionTool is designed for.
                self.conversation_context["last_error_details"] = tool_output 
                error_msg_for_history = f"There was an issue with order {order_num} ({order_type}): {tool_output.get('message', 'Unknown error from query tool')}. Let me try to find a solution."
                self._add_to_history("assistant", error_msg_for_history)
                action = "HANDLE_EXCEPTION" # Transition to handle this error/status

        if action == "HANDLE_EXCEPTION":
            error_details = self.conversation_context.get("last_error_details")
            order_num_ctx = self.conversation_context.get("order_number", "N/A") # Use context order number
            order_type_ctx = self.conversation_context.get("order_type", "N/A") # Use context order type

            if not error_details: # Should not happen if flow is correct
                fallback_msg = "I'm sorry, I encountered an issue but lost the specific details. Could you please try your query again?"
                self._add_to_history("assistant", fallback_msg)
                return {"response": fallback_msg, "context": self.conversation_context, "error": "Missing error_details for HANDLE_EXCEPTION"}

            tool_output = await self.tools["handle_order_exception"].handle(order_num_ctx, order_type_ctx, error_details)
            
            # Check if the HandleOrderExceptionTool itself had an issue (e.g. dummy tool)
            if tool_output.get("error") and "Tool 'HandleOrderExceptionTool' not loaded" in tool_output.get("error",""):
                response_message = "I'm currently unable to process order exceptions due to an internal issue. Please try again later."
                self._add_to_history("assistant", response_message)
                return {"response": response_message, "error": tool_output.get("error"), "context": self.conversation_context}

            final_user_message = tool_output.get("user_message", f"I've processed the error information for order {order_num_ctx}, but couldn't generate specific advice right now.")
            
            # If the exception tool's LLM failed, it might return its own error in "error" key.
            # We don't want to append this if it's just "OpenAI client not initialized" as that's handled by the tool's fallback message.
            if tool_output.get("error") and "OpenAI client not initialized" not in tool_output.get("error", ""):
                 final_user_message += f" (Note: {tool_output['error']})"
            
            self._add_to_history("assistant", final_user_message)
            # The response from handle_order_exception is the primary payload.
            # It might contain an "error" field if the *tool itself* failed (e.g. LLM call within tool).
            # This "error" field from the tool will be caught by main.py if it's returned at the top level.
            response_payload = {"response": final_user_message, "exception_info": tool_output, "context": self.conversation_context}
            if tool_output.get("error"): # Propagate tool's own error if one occurred
                response_payload["error"] = tool_output.get("error")
            return response_payload


        # Fallback or RESPOND_DIRECTLY if no tool action was decisively taken or completed.
        # This path should ideally be reached only if action is "RESPOND_DIRECTLY" from the start,
        # or if an action sequence didn't result in a returned response.
        # Note: self.client check already happened at the beginning of process_request.
        # If it's None here, it means the initial check passed (e.g. dummy key was present but considered "valid enough" by old check)
        # but LLM dependent operations will fail. The more robust check at the start of process_request should prevent this.

        try:
            system_message_for_direct_response = "You are a helpful assistant. The user's last query did not result in a specific tool action, or a previous action completed and now direct response is needed. Please provide a relevant response based on the conversation history."
            messages_for_llm = [{"role": "system", "content": system_message_for_direct_response}] + self.history
            
            if not self.client: # Should have been caught by the very first check in process_request.
                 # This is a safeguard. If reached, it means a dummy key might have passed initial checks
                 # but is now correctly identified as preventing LLM calls.
                 print("ERROR: LLM client is None at RESPOND_DIRECTLY fallback. API key issue.")
                 final_fallback_msg = "I'm having trouble connecting to my main processing services at the moment. Please try again later."
                 self._add_to_history("assistant", final_fallback_msg)
                 return {"response": final_fallback_msg, "context": self.conversation_context, "error": "OpenAI client not available for direct response."}

            response = self.client.chat.completions.create(
                model=self.model_name,
                messages=messages_for_llm
            )
            assistant_response = response.choices[0].message.content
            self._add_to_history("assistant", assistant_response)
            return {"response": assistant_response, "context": self.conversation_context}
        except Exception as e:
            print(f"ERROR: Error in final LLM fallback call: {e}") # For agent's own console
            self._add_to_history("assistant", "I'm having some technical difficulties processing your request. Please try again in a moment.")
            # This error will be caught by main.py and logged, then returned as HTTPException
            return {"error": f"Failed to get final response from OpenAI model: {str(e)}", "context": self.conversation_context}


if __name__ == '__main__':
    async def run_agent_tests():
        # .env should be in agent_backend (parent of app where agent.py is)
        # Correct path for dotenv when agent.py is in app/
        env_path_for_agent_test = os.path.join(os.path.dirname(__file__), '..', '.env')
        if not os.path.exists(env_path_for_agent_test):
            print(f"INFO: Creating dummy .env at {env_path_for_agent_test} for agent test.") # Changed to INFO
            with open(env_path_for_agent_test, "w") as f:
                f.write("OPENAI_API_KEY=\"dummy_key_for_subtask_environment\"\n") 
        
        load_dotenv(dotenv_path=env_path_for_agent_test, override=True) # Load .env from agent_backend/

        api_key_present = os.getenv("OPENAI_API_KEY") and os.getenv("OPENAI_API_KEY") != "dummy_key_for_subtask_environment"
        if not api_key_present:
            # Standard print, as this is a test script console output.
            print("WARNING: A real OPENAI_API_KEY is not set in .env. Agent tests requiring LLM calls will use fallbacks or show errors related to dummy/missing key.")
        
        agent = Agent()
        # The agent __init__ and process_request methods now have checks for dummy/missing keys.

        test_scenarios = [
            {"name": "Greeting", "query": "Hello there!", "expected_action_partial": "RESPOND_DIRECTLY"},
            {"name": "Initial Order Query - Vague", "query": "I need to check my order.", "expected_action_partial": "EXTRACT_DETAILS"},
            {"name": "Order Query - With Number Only", "query": "My order is 12345", "expected_action_partial": "EXTRACT_DETAILS"},
            {"name": "Order Query - With Number and Type", "query": "My order is 12345 and it's an electronics item.", "expected_action_partial": "EXTRACT_DETAILS"}, # Then transitions to QUERY_STATUS
            {"name": "Order Query - Known Good", "query": "Check status for 12345, electronics", "context_before": {"order_number": "12345", "order_type": "electronics"}, "expected_action_partial": "QUERY_STATUS"},
            {"name": "Order Query - Known Error (simulated in query tool)", "query": "What about order ERR01, electronics?", "context_before": {"order_number": "ERR01", "order_type": "electronics"}, "expected_action_partial": "QUERY_STATUS"}, # Then transitions to HANDLE_EXCEPTION
            {"name": "Order Query - Type Mismatch (simulated in query tool)", "query": "Is order 12345, type books, ready?", "context_before": {"order_number": "12345", "order_type": "books"}, "expected_action_partial": "QUERY_STATUS"}, # Then HANDLE_EXCEPTION for type_mismatch
        ]

        for test in test_scenarios:
            print(f"\n--- Test Scenario: {test['name']} ---")
            agent.history = [] # Reset history for each scenario
            agent.conversation_context = test.get("context_before", {}) # Set pre-existing context if any
            
            print(f"User Query: {test['query']}")
            if agent.conversation_context:
                print(f"Context Before: {agent.conversation_context}")

            result = await agent.process_request(test['query'])
            # These prints are for the __main__ test execution, not for the FastAPI app logging.
            print(f"Agent Final Response: {json.dumps(result.get('response', result.get('error', 'No response/error key found in result')), indent=2)}")
            if "context" in result:
                 print(f"Context After: {json.dumps(result['context'], indent=2)}")
            if "data" in result: # Typically from successful query_order_status
                 print(f"Data from tool: {json.dumps(result['data'], indent=2)}")
            if "exception_info" in result: # Typically from handle_order_exception
                 print(f"Exception Info: {json.dumps(result['exception_info'], indent=2)}")
            if "error" in result: # If the agent itself determined an error condition to be returned to FastAPI
                 print(f"Error key from agent: {result['error']}")
            print("--- End Scenario ---")

    if os.name == 'nt':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(run_agent_tests())
