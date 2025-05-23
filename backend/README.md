# Agent Backend Proxy

## 1. Project Overview

This project implements an agent backend proxy using Python, FastAPI, and OpenAI. The agent is designed to handle complex tasks by orchestrating multiple tools. It demonstrates an order query functionality where it can extract order details, query order status, and handle exceptions in the process.

## 2. Features

*   **OpenAI-Powered Agent**: Utilizes OpenAI's language models for decision-making and natural language understanding.
*   **Multi-Tool Orchestration**: Capable of deciding which tool to use for a given task.
    *   **Order Detail Extraction**: Extracts order number and type from user queries.
    *   **Order Status Query**: Queries the status of an order (currently uses mock data).
    *   **Exception Handling**: Provides user-friendly messages for errors encountered during order processing.
*   **FastAPI Backend**: Exposes functionality via a RESTful API.
*   **Async Operations**: Built with `asyncio` for non-blocking I/O.
*   **Basic Logging**: Logs API requests and critical events to console and a file (`agent_backend.log`).
*   **Unit Tests**: Includes tests for tools and agent logic.

## 3. Project Structure

```
agent_backend/
├── app/                        # Main application: FastAPI app, agent logic
│   ├── __init__.py
│   ├── agent.py                # Core Agent class
│   └── main.py                 # FastAPI application and endpoints
├── tools/                      # Individual tools callable by the agent
│   ├── __init__.py
│   ├── extract_order_details.py
│   ├── query_order_status.py
│   └── handle_order_exception.py
├── tests/                      # Unit tests
│   ├── __init__.py
│   ├── test_agent.py
│   └── test_tools.py
├── .env.example                # Example environment file
├── .gitignore
├── README.md                   # This file
└── requirements.txt            # Python dependencies
└── agent_backend.log           # Log file (created when app runs)
```

## 4. Setup and Installation

### Prerequisites

*   Python 3.8+
*   [UV](https://github.com/astral-sh/uv) (for package management, optional but recommended)
*   Git (for cloning, if applicable)

### Installation Steps

1.  **Clone the Repository** (if you have it as a Git repo):
    ```bash
    git clone <repository_url>
    cd agent_backend
    ```
    If you received the files directly, navigate to the `agent_backend` directory.

2.  **Create a Virtual Environment** (Recommended):
    ```bash
    python -m venv .venv
    source .venv/bin/activate  # On Windows: .venv\Scriptsctivate
    ```

3.  **Install Dependencies**:
    If using UV:
    ```bash
    uv pip install -r requirements.txt
    ```
    If using pip:
    ```bash
    pip install -r requirements.txt
    ```

4.  **Set up Environment Variables**:
    Create a `.env` file in the `agent_backend` root directory by copying `.env.example` (if provided) or creating it manually.
    Add your OpenAI API key to it:
    ```env
    # agent_backend/.env
    OPENAI_API_KEY="your_openai_api_key_here"
    ```
    Replace `"your_openai_api_key_here"` with your actual key.

## 5. Running the Application

1.  **Start the FastAPI Server**:
    Ensure your virtual environment is activated and you are in the `agent_backend` directory.
    ```bash
    uvicorn app.main:app --reload --port 8000
    ```
    The `--reload` flag is useful for development as it automatically reloads the server when code changes.

2.  **Access API Documentation**:
    Once the server is running, you can access the interactive API documentation in your browser:
    *   Swagger UI: [http://localhost:8000/api/docs](http://localhost:8000/api/docs)
    *   ReDoc: [http://localhost:8000/api/redoc](http://localhost:8000/api/redoc)

## 6. Using the API

The primary endpoint for interacting with the agent is `/api/chat`.

### Request

*   **Method**: `POST`
*   **URL**: `http://localhost:8000/api/chat`
*   **Body** (JSON):
    ```json
    {
        "user_query": "Your question or statement for the agent"
    }
    ```

### Response

*   **Success** (200 OK):
    ```json
    {
        "data": {
            "response": "Agent's response string"
            // other context-specific fields like 'context', 'data' from tools, 'exception_info' might be present
        },
        "message": "Processed successfully"
    }
    ```
*   **Error** (e.g., 400, 500, 503):
    ```json
    {
        "detail": "Error message string"
    }
    ```

### Example Conversation (Order Query)

1.  **User**: "I want to check my order."
    ```bash
    curl -X POST http://localhost:8000/api/chat     -H "Content-Type: application/json"     -d '{"user_query": "I want to check my order."}'
    ```
    **Agent (Expected)**: Asks for order number and type. (e.g., `{"data":{"response":"Okay, I can help with that. What is your order number and order type?","context":{}}...}`)

2.  **User**: "My order is 12345 and it's electronics."
    ```bash
    curl -X POST http://localhost:8000/api/chat     -H "Content-Type: application/json"     -d '{"user_query": "My order is 12345 and it'''s electronics."}'
    ```
    **Agent (Expected)**: Provides status for order 12345. (e.g., `{"data":{"response":"Order 12345 (electronics): Status is 'Shipped'. Additional details: {"carrier": "FedEx", "tracking_id": "FX123456789"}}","data":{...}}...`)

3.  **User**: "What about order ERR01, type electronics?" (This order is designed to have an issue in mock data)
    ```bash
    curl -X POST http://localhost:8000/api/chat     -H "Content-Type: application/json"     -d '{"user_query": "What about order ERR01, type electronics?"}'
    ```
    **Agent (Expected)**: Provides a user-friendly error message and suggested actions. (e.g., Message about inventory not available).

4.  **User**: "My order is 98765."
    ```bash
    curl -X POST http://localhost:8000/api/chat     -H "Content-Type: application/json"     -d '{"user_query": "My order is 98765."}'
    ```
    **Agent (Expected)**: Asks for the order type. (e.g., "...Order type is missing. Please provide the missing information: Order Type.")

5.  **User**: "It's an electronics item." (Assuming agent maintains context of order 98765)
    ```bash
    curl -X POST http://localhost:8000/api/chat     -H "Content-Type: application/json"     -d '{"user_query": "It is an electronics item."}'
    ```
    **Agent (Expected)**: Provides status for order 98765. (e.g., "...Order 98765 (electronics): Status is 'Processing'...")

## 7. Running Tests

Ensure you are in the `agent_backend` root directory and your virtual environment is activated.

To discover and run all unit tests:
```bash
python -m unittest discover -s tests -p "test_*.py"
```
Or, if you have `pytest` installed (it's not in `requirements.txt` by default but is a common choice):
```bash
pytest tests/
```

## 8. Tools Overview

*   **`ExtractOrderDetailsTool`**: Uses an LLM to identify and extract order numbers and types from user text.
*   **`QueryOrderStatusTool`**: Simulates fetching order status from a backend. Currently returns mock data based on predefined order numbers and types.
*   **`HandleOrderExceptionTool`**: Uses an LLM to generate helpful, user-friendly messages and suggested actions when an order query results in an error or an exceptional state.

## 9. Future Enhancements

*   **Session Management**: Implement proper session handling to maintain conversation context across multiple API calls for different users.
*   **Advanced Tool Orchestration**: Utilize OpenAI's Function Calling feature for more robust and flexible tool selection.
*   **Real Backend Integration**: Replace mock data in `QueryOrderStatusTool` with actual database or API calls.
*   **More Tools**: Add more tools for diverse functionalities.
*   **Configuration Management**: More sophisticated configuration for model names, prompts, etc.
*   **Streaming Responses**: Implement streaming for LLM responses for better perceived performance.
```
