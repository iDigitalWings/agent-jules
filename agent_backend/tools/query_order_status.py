import asyncio
import random

class QueryOrderStatusTool:
    async def query(self, order_number: str, order_type: str):
        """
        Simulates querying an order status from a backend system.
        Returns mock data for now.
        """
        # Ensure inputs are strings, as they might come from JSON parsing or user input
        order_number = str(order_number) if order_number is not None else ""
        order_type = str(order_type) if order_type is not None else ""


        print(f"Simulating query for order: {order_number}, type: {order_type}")
        await asyncio.sleep(0.5) # Simulate network delay, reduced for faster testing

        # Mock database of orders
        mock_orders = {
            "12345": {"type": "electronics", "status": "Shipped", "details": {"carrier": "FedEx", "tracking_id": "FX123456789"}},
            "98765": {"type": "electronics", "status": "Processing", "details": {"estimated_ship_date": "2023-10-28"}},
            "ABCDE": {"type": "books", "status": "Delivered", "details": {"delivery_date": "2023-10-20"}},
            "XYZ00": {"type": "clothing", "status": "Pending Payment", "details": {"reason": "Awaiting payment confirmation."}},
            "ERR01": {"type": "electronics", "status": "Error", "details": {"error_code": "E102", "message": "Inventory not available."}},
            "MULTI": {"type": "groceries", "status": "Partially Shipped", "details": {"shipped_items": ["Apples", "Bananas"], "pending_items": ["Milk"]}}
        }

        normalized_order_type = order_type.lower()

        if order_number in mock_orders:
            order_data = mock_orders[order_number]
            if order_data["type"].lower() == normalized_order_type:
                return {
                    "status": "success", # Indicates successful query and data retrieval
                    "order_number": order_number,
                    "order_type": order_type, # Return original case for consistency
                    "order_status_from_backend": order_data["status"], # More specific key
                    "data": order_data["details"]
                }
            else:
                return {
                    "status": "error", # Use a general 'error' status for operational issues like mismatch
                    "error_type": "type_mismatch", # Specific error type
                    "order_number": order_number,
                    "order_type": order_type,
                    "message": f"Order '{order_number}' found, but type mismatch. Backend has type '{order_data['type']}', query was for '{order_type}'."
                }
        else:
            # Simulate a generic "not found" or a random error for other cases
            if random.random() < 0.1: # 10% chance of a simulated backend error
                 return {
                    "status": "error",
                    "error_type": "simulated_backend_error",
                    "order_number": order_number,
                    "order_type": order_type,
                    "message": "A simulated backend error occurred while fetching order status."
                }
            return {
                "status": "not_found", # Specific status for when the order doesn't exist
                "order_number": order_number,
                "order_type": order_type,
                "message": f"Order '{order_number}' of type '{order_type}' not found."
            }

if __name__ == '__main__':
    async def main_test_query():
        tool = QueryOrderStatusTool()

        test_cases = [
            ("12345", "electronics"),
            ("98765", "Electronics"), # Test case-insensitivity for type
            ("ABCDE", "books"),
            ("XYZ00", "clothing"),
            ("ERR01", "electronics"),
            ("12345", "books"),       # Type mismatch
            ("00000", "electronics"),  # Not found
            ("MULTI", "groceries"),
            (None, "electronics"),     # Test with None order_number
            ("12345", None)            # Test with None order_type
        ]

        for on, ot in test_cases:
            print(f"Querying: Order Number='{on}', Order Type='{ot}'")
            result = await tool.query(on, ot)
            print(f"Result: {result}\n")

    import os
    if os.name == 'nt': # For Windows compatibility with asyncio
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main_test_query())
