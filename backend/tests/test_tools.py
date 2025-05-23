# agent_backend/tests/test_tools.py
import unittest
import asyncio
import os
import sys # Added missing import
import json # Ensure json is imported
from unittest.mock import patch, MagicMock, AsyncMock

# Ensure tools can be imported. Adjust path if necessary.
project_root_for_tests = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if project_root_for_tests not in sys.path:
    sys.path.insert(0, project_root_for_tests)

# It's good practice to ensure __init__.py exists in the 'tools' directory
# For this subtask, we assume it does or that imports work without it based on structure.
try:
    from tools.query_order_status import QueryOrderStatusTool
    from tools.extract_order_details import ExtractOrderDetailsTool
    from tools.handle_order_exception import HandleOrderExceptionTool
except ImportError as e:
    print(f"ERROR (test_tools): Failed to import tools. Ensure they exist and agent_backend/tools has __init__.py. Error: {e}")
    # Define dummy classes if import fails, so tests can at least be discovered
    class QueryOrderStatusTool: pass
    class ExtractOrderDetailsTool: pass
    class HandleOrderExceptionTool: pass


# Helper to run async functions in unittest
def async_test(f):
    def wrapper(*args, **kwargs):
        # A more robust async test wrapper might be needed depending on the test runner and event loop policy
        # For standard unittest, asyncio.run is often sufficient.
        asyncio.run(f(*args, **kwargs))
    return wrapper

class TestQueryOrderStatusTool(unittest.TestCase):
    def setUp(self):
        self.tool = QueryOrderStatusTool()

    @async_test
    async def test_query_success_electronics(self):
        result = await self.tool.query("12345", "electronics")
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["order_number"], "12345")
        self.assertEqual(result["order_type"], "electronics")
        self.assertEqual(result["order_status_from_backend"], "Shipped")
        self.assertIn("tracking_id", result["data"])

    @async_test
    async def test_query_success_books(self):
        result = await self.tool.query("ABCDE", "books")
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["order_status_from_backend"], "Delivered")

    @async_test
    async def test_query_type_mismatch(self):
        result = await self.tool.query("12345", "books") # Corrected order number for mismatch test
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["error_type"], "type_mismatch")
        self.assertIn("Order '12345' found, but type mismatch", result["message"])

    @async_test
    async def test_query_not_found(self):
        # Use a non-mocked random value path first
        with patch('tools.query_order_status.random.random', return_value=0.5): # Ensure not triggering simulated error
            result = await self.tool.query("00000", "electronics")
            self.assertEqual(result["status"], "not_found")
            self.assertIn("Order '00000' of type 'electronics' not found", result["message"])

    @patch('tools.query_order_status.random.random', return_value=0.05) # Force simulated error ( < 0.1)
    @async_test
    async def test_query_simulated_backend_error(self, mock_random):
        result = await self.tool.query("77777", "clothing") 
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["error_type"], "simulated_backend_error")
        self.assertIn("simulated backend error occurred", result["message"])

class TestExtractOrderDetailsTool(unittest.TestCase):
    def setUp(self):
        # Create a dummy .env in agent_backend if it doesn't exist for tool's own load_dotenv.
        # This helps the tool initialize without complaining about a missing .env if it tries to load one.
        self.env_path = os.path.join(project_root_for_tests, '.env')
        if not os.path.exists(self.env_path):
            print(f"INFO (test_tools): Creating dummy .env at {self.env_path} for test setup of ExtractOrderDetailsTool.")
            with open(self.env_path, "w") as f:
                f.write("OPENAI_API_KEY=\"dummy_key_for_testing\"\n") # Corrected syntax
        
        # Patch the OpenAI client within the tool instance for all tests in this class
        self.patcher = patch('tools.extract_order_details.OpenAI', spec=True)
        self.MockOpenAI = self.patcher.start()
        self.mock_openai_instance = self.MockOpenAI.return_value # This is the instance of OpenAI client
        self.mock_openai_instance.chat.completions.create = AsyncMock() # Mock the async method

        self.tool = ExtractOrderDetailsTool() # Now, when Tool() is called, it uses the mocked OpenAI

    def tearDown(self):
        self.patcher.stop() # Important to stop the patch

    @async_test
    async def test_extract_full_details_success(self):
        mock_response_content = {
            "order_number": "B4567", "order_type": "gadgets", "status_message": "Order number and type extracted."
        }
        self.mock_openai_instance.chat.completions.create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=json.dumps(mock_response_content)))]
        )
        result = await self.tool.extract("My order is B4567 for gadgets")
        self.assertEqual(result["order_number"], "B4567")
        self.assertEqual(result["order_type"], "gadgets")
        self.mock_openai_instance.chat.completions.create.assert_called_once()

    @async_test
    async def test_extract_only_order_number(self):
        mock_response_content = {"order_number": "C1234", "order_type": None, "status_message": "Order type is missing."}
        self.mock_openai_instance.chat.completions.create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=json.dumps(mock_response_content)))]
        )
        result = await self.tool.extract("Order is C1234")
        self.assertEqual(result["order_number"], "C1234")
        self.assertIsNone(result["order_type"])

    @async_test
    async def test_extract_openai_api_error(self):
        self.mock_openai_instance.chat.completions.create.side_effect = Exception("OpenAI API Error")
        result = await self.tool.extract("My order is D5678 type electronics")
        self.assertIn("error", result)
        self.assertTrue("Failed to extract details" in result["error"])

    @async_test
    async def test_extract_invalid_json_response(self):
        self.mock_openai_instance.chat.completions.create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content="This is not JSON"))] # Invalid JSON
        )
        result = await self.tool.extract("Order E91011, type books")
        self.assertIn("error", result)
        self.assertTrue("Failed to parse extraction result" in result["error"])

class TestHandleOrderExceptionTool(unittest.TestCase):
    def setUp(self):
        self.env_path = os.path.join(project_root_for_tests, '.env')
        if not os.path.exists(self.env_path):
            print(f"INFO (test_tools): Creating dummy .env at {self.env_path} for test setup of HandleOrderExceptionTool.")
            with open(self.env_path, "w") as f:
                f.write("OPENAI_API_KEY=\"dummy_key_for_testing\"\n") # Corrected syntax

        self.patcher = patch('tools.handle_order_exception.OpenAI', spec=True)
        self.MockOpenAI = self.patcher.start()
        self.mock_openai_instance = self.MockOpenAI.return_value
        self.mock_openai_instance.chat.completions.create = AsyncMock()
        
        self.tool = HandleOrderExceptionTool()

    def tearDown(self):
        self.patcher.stop()

    @async_test
    async def test_handle_inventory_error(self):
        mock_response_content = {
            "user_message": "The item (ERR01, electronics) is out of stock.",
            "suggested_actions": ["Check back later.", "Contact support."]
        }
        self.mock_openai_instance.chat.completions.create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=json.dumps(mock_response_content)))]
        )
        error_details = {"error_code": "E102", "message": "Inventory not available."}
        result = await self.tool.handle("ERR01", "electronics", error_details)
        self.assertEqual(result["user_message"], "The item (ERR01, electronics) is out of stock.")
        self.assertListEqual(result["suggested_actions"], ["Check back later.", "Contact support."])

    @async_test
    async def test_handle_api_error_on_exception_tool(self):
        self.mock_openai_instance.chat.completions.create.side_effect = Exception("OpenAI API Error")
        error_details = {"reason": "Awaiting payment."}
        result = await self.tool.handle("PAY01", "clothing", error_details)
        self.assertIn("error", result)
        self.assertTrue("Failed to generate exception handling message" in result["error"])

if __name__ == "__main__":
    # This allows running tests via `python agent_backend/tests/test_tools.py`
    # Ensure that the environment (PYTHONPATH) is set up correctly if running this way.
    # Typically, a test runner like pytest would handle discovery and execution from the root.
    unittest.main()
