import os
from openai import OpenAI
from dotenv import load_dotenv
import json # Ensure json is imported

# Load .env from the parent directory (agent_backend)
# This assumes the script is run from within the tools directory or that the path is relative to the script location.
# For consistency, it's often better to manage .env loading at the application entry point.
dotenv_path = os.path.join(os.path.dirname(__file__), '..', '.env')
load_dotenv(dotenv_path=dotenv_path)

class ExtractOrderDetailsTool:
    def __init__(self, model_name="gpt-3.5-turbo"):
        self.api_key = os.getenv("OPENAI_API_KEY")
        if not self.api_key:
            # This warning is useful during development
            print("Warning: OPENAI_API_KEY not found. Tool will not function without it.")
            self.client = None # Or handle this more gracefully
        else:
            self.client = OpenAI(api_key=self.api_key)
        self.model_name = model_name

    async def extract(self, user_query: str, conversation_history: list = None):
        """
        Extracts order number and order type from the user query.
        If order type is missing, it should indicate that.
        """
        if not self.client:
            return {"error": "OpenAI client not initialized. API key might be missing."}

        system_prompt = """
        You are an expert at extracting order details from user queries.
        Your task is to identify the order number and the order type.
        The order number is usually a sequence of digits, possibly with letters.
        The order type could be categories like 'electronics', 'clothing', 'books', 'groceries', etc.
        If the user only provides an order number but no type, explicitly state that the order type is missing.
        If the user provides both, extract both.
        If the user provides neither, state that both are missing.
        Respond in JSON format with the following keys: "order_number", "order_type", "status_message".
        "status_message" should indicate if details are missing or successfully extracted.

        Example 1:
        User query: "I want to check my order 12345, it's an electronics item."
        Response: {"order_number": "12345", "order_type": "electronics", "status_message": "Order number and type extracted."}

        Example 2:
        User query: "My order is 98765."
        Response: {"order_number": "98765", "order_type": null, "status_message": "Order type is missing."}
        
        Example 3:
        User query: "What's the status?"
        Response: {"order_number": null, "order_type": null, "status_message": "Order number and order type are missing."}
        """

        messages = [{"role": "system", "content": system_prompt}]
        if conversation_history:
            # Ensure conversation history is well-formed (list of dicts with 'role' and 'content')
            for message in conversation_history:
                if not (isinstance(message, dict) and "role" in message and "content" in message):
                    return {"error": "Invalid conversation history format."}
            messages.extend(conversation_history)
        messages.append({"role": "user", "content": user_query})
        
        try:
            response = self.client.chat.completions.create(
                model=self.model_name,
                messages=messages,
                response_format={"type": "json_object"}
            )
            extracted_info_str = response.choices[0].message.content
            # Attempt to parse the JSON string from the model
            return json.loads(extracted_info_str)
        except json.JSONDecodeError:
            # Handle cases where the model doesn't return valid JSON despite the prompt
            print(f"Error: Model did not return valid JSON. Response: {extracted_info_str}")
            return {"error": "Failed to parse extraction result from model. Model response was not valid JSON."}
        except Exception as e:
            print(f"Error calling OpenAI API for extraction: {e}")
            return {"error": f"Failed to extract details using OpenAI model: {str(e)}"}

if __name__ == '__main__':
    # Example usage (for testing purposes)
    async def main_test_extraction():
        # This __main__ block is for testing the tool directly.
        # It assumes agent_backend/.env contains the OPENAI_API_KEY.
        
        # Reload .env specifically for this test script, in case it wasn't loaded or was cleared.
        # The path should be relative to this file's location (tools directory)
        current_dir_dotenv_path = os.path.join(os.path.dirname(__file__), '..', '.env')
        if not os.path.exists(current_dir_dotenv_path):
            print(f".env file not found at {current_dir_dotenv_path}. Creating a dummy one for the test.")
            with open(current_dir_dotenv_path, "w") as f:
                f.write("OPENAI_API_KEY=\"dummy_key_for_subtask_environment\"\n") # Corrected syntax here
        
        load_dotenv(dotenv_path=current_dir_dotenv_path, override=True) # Override to ensure it's loaded for this test

        api_key_for_test = os.getenv("OPENAI_API_KEY")

        if not api_key_for_test or api_key_for_test == "dummy_key_for_subtask_environment":
            print("OPENAI_API_KEY not set or is a dummy key. Skipping OpenAI call in extraction tool's __main__ block.")
            print(f"Please ensure a valid API key is set in {current_dir_dotenv_path} for local testing.")
            return

        tool = ExtractOrderDetailsTool()
        # Check again if client was initialized (it wouldn't be if key was missing at __init__)
        if not tool.client:
            print("OpenAI client not initialized in tool. Exiting test.")
            return

        queries = [
            "I want to check my order 12345, it's an electronics item.",
            "My order is 98765.",
            "What's the status of my book order?",
            "Can you find order ABCDE123 for clothing?",
            "I need help with my order."
        ]

        for query in queries:
            print(f"User Query: {query}")
            # Example of providing some history (though not strictly necessary for this tool alone)
            # history_example = [
            #     {"role": "user", "content": "I need help with an order."},
            #     {"role": "assistant", "content": "Sure, what is your order number and type?"}
            # ]
            # result = await tool.extract(query, conversation_history=history_example)
            result = await tool.extract(query)
            print(f"Extraction Result: {result}\n")
    
    import asyncio
    if os.name == 'nt': # For Windows compatibility with asyncio
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main_test_extraction())
