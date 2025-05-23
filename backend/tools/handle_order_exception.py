import os
from openai import OpenAI
from dotenv import load_dotenv
import json
import asyncio # Added for __main__ block

# Load .env from the parent directory (agent_backend)
dotenv_path = os.path.join(os.path.dirname(__file__), '..', '.env')
load_dotenv(dotenv_path=dotenv_path)

class HandleOrderExceptionTool:
    def __init__(self, model_name="gpt-3.5-turbo"):
        self.api_key = os.getenv("OPENAI_API_KEY")
        if not self.api_key or self.api_key == "dummy_key_for_subtask_environment": # Check for dummy key too
            print("Warning: OPENAI_API_KEY not found or is a dummy key for HandleOrderExceptionTool.")
            self.client = None
        else:
            self.client = OpenAI(api_key=self.api_key)
        self.model_name = model_name

    async def handle(self, order_number: str, order_type: str, error_details: dict):
        """
        Generates a user-friendly message and suggested actions for an order exception.
        """
        if not self.client:
            return {
                "user_message": f"I'm having trouble providing detailed assistance for order {order_number} due to a configuration issue on my end. Please try again later or contact support directly.",
                "suggested_actions": ["Try your request again in a few minutes.", "Contact customer support if the issue persists."],
                "error": "OpenAI client not initialized for exception handling. API key might be missing or invalid."
            }

        # Construct a prompt for the OpenAI model
        # Ensure error_details is a string representation for the prompt if it's a dict
        error_details_str = json.dumps(error_details, indent=2) if isinstance(error_details, dict) else str(error_details)

        prompt = f"""
        An issue was encountered while processing an order query for Order Number: '{order_number}', Type: '{order_type}'.
        The details of the issue are: {error_details_str}

        Please generate a user-friendly message explaining this issue and suggest potential actions the user or support team could take.
        The tone should be helpful and empathetic.
        If the error indicates 'Inventory not available' or similar, suggest checking back later or contacting support for alternatives.
        If it's a 'Pending Payment' issue, suggest completing the payment.
        If the error is a 'type_mismatch', explain that the order was found but the type provided doesn't match the record, and ask to verify.
        For generic errors, 'not_found' (if this tool is ever called for it), or simulated backend errors,
        suggest re-checking the order details or contacting support for assistance.

        Respond ONLY in JSON format with two keys: "user_message" and "suggested_actions".
        "user_message" should be a string to display to the user.
        "suggested_actions" should be a list of strings.

        Example for 'Inventory not available' (error_details might contain more specific info):
        {{
            "user_message": "We encountered an issue with your order {order_number} ({order_type}): an item is currently out of stock. We apologize for any inconvenience.",
            "suggested_actions": [
                "Please check back soon for stock updates.",
                "Contact customer support to explore alternative items or get an ETA.",
                "You can also cancel this part of the order if you prefer."
            ]
        }}
        
        Example for 'type_mismatch' (error_details includes actual_type):
        {{
            "user_message": "We found order {order_number}, but it appears to be a '{json.loads(error_details_str).get('actual_type', 'different category') if isinstance(error_details, dict) else 'different category'}' item, not a '{order_type}' item as you mentioned. Could you please verify the order type you're interested in?",
            "suggested_actions": [
                "Double-check the order type and try again.",
                "Provide the correct order type to get the accurate status.",
                "If you believe this is our error, please contact support with the order number."
            ]
        }}
        """

        try:
            response = self.client.chat.completions.create(
                model=self.model_name,
                messages=[
                    {"role": "system", "content": "You are a helpful assistant for resolving order issues. You always respond in the specified JSON format."},
                    {"role": "user", "content": prompt}
                ],
                response_format={"type": "json_object"}
            )
            content = response.choices[0].message.content
            # Basic validation of JSON structure
            parsed_content = json.loads(content)
            if "user_message" not in parsed_content or "suggested_actions" not in parsed_content:
                raise json.JSONDecodeError("Missing required keys in JSON response.", content, 0)
            return parsed_content
        except json.JSONDecodeError as je:
            print(f"Error: Model did not return valid JSON or expected structure for exception handling. Response: {content if 'content' in locals() else 'No content from model'}. Error: {je}")
            # Fallback response
            return {
                "user_message": f"I encountered an unexpected issue while trying to understand the problem with order {order_number}. Please try again, or contact support if the problem continues.",
                "suggested_actions": ["Retry your request.", "Contact customer support with order number " + order_number + " and the error details: " + error_details_str],
                "error": "Failed to parse exception handling result from model.",
                "raw_response": content if "content" in locals() else "No content from model"
                }
        except Exception as e:
            print(f"Error calling OpenAI API for exception handling: {e}")
            return {
                "user_message": f"Sorry, I ran into a problem while trying to get help for order {order_number}. The details are: {error_details_str}",
                "suggested_actions": ["Please try your request again in a moment.", "If it still doesn't work, customer support might be able to help directly."],
                "error": f"Failed to generate exception handling message using OpenAI model: {str(e)}"
                }

if __name__ == '__main__':
    async def main_test_exception_handling():
        # Ensure .env is loaded
        current_dir_dotenv_path = os.path.join(os.path.dirname(__file__), '..', '.env')
        if not os.path.exists(current_dir_dotenv_path):
            print(f".env file not found at {current_dir_dotenv_path}. Creating dummy for test.")
            with open(current_dir_dotenv_path, "w") as f:
                f.write("OPENAI_API_KEY=\"dummy_key_for_subtask_environment\"\n") # Corrected syntax
        load_dotenv(dotenv_path=current_dir_dotenv_path, override=True)

        api_key_for_test = os.getenv("OPENAI_API_KEY")
        if not api_key_for_test or api_key_for_test == "dummy_key_for_subtask_environment":
            print("OPENAI_API_KEY not set or is dummy. OpenAI calls in exception tool's __main__ will use fallback.")
            # Even if dummy, we proceed to test the fallback logic within the tool.

        tool = HandleOrderExceptionTool()
        # The tool itself handles the case where self.client is None.

        test_cases = [
            ("ERR01", "electronics", {"from_query_tool": True, "status": "Error", "details": {"error_code": "E102", "message": "Inventory not available."}}),
            ("XYZ00", "clothing", {"from_query_tool": True, "status": "Pending Payment", "details": {"reason": "Awaiting payment confirmation."}}),
            ("12345", "books", {"from_query_tool": True, "status": "error", "error_type": "type_mismatch", "message": "Order '12345' found, but type mismatch. Backend has type 'electronics', query was for 'books'.", "actual_type": "electronics"}),
            ("SIMUL", "gadgets", {"from_query_tool": True, "status": "error", "error_type": "simulated_backend_error", "message": "A simulated backend error occurred."})
        ]

        for on, ot, err_details in test_cases:
            print(f"Handling exception for: Order Number='{on}', Type='{ot}', Details={err_details}")
            result = await tool.handle(on, ot, err_details)
            print(f"Handling Result: {json.dumps(result, indent=2)}\n") # Corrected formatting
            
    if os.name == 'nt':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main_test_exception_handling())
