from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import os
import sys
import asyncio # Required for Agent if it has async methods
import logging
from logging.handlers import RotatingFileHandler

# Add project root to sys.path to allow importing agent and tools
# This assumes the script is in agent_backend/app/
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if project_root not in sys.path:
    sys.path.insert(0, project_root) # Insert at the beginning to prioritize project modules

# Setup Structured Logging
log_file_path = os.path.join(project_root, "agent_backend.log")
logger = logging.getLogger("api") # Using "api" as the logger name
logger.setLevel(logging.INFO)

# Formatter
formatter = logging.Formatter("%(asctime)s - %(levelname)s - %(name)s - %(module)s - %(funcName)s - %(lineno)d - %(message)s")

# Rotating File Handler
rfh = RotatingFileHandler(log_file_path, maxBytes=10*1024*1024, backupCount=5) # 10MB per file, 5 backups
rfh.setFormatter(formatter)
logger.addHandler(rfh)

# Stream Handler (console)
sh = logging.StreamHandler()
sh.setFormatter(formatter)
logger.addHandler(sh)


logger.info("FastAPI application starting up...")

# Now we can import the Agent class from app.agent
# Ensure that agent.py and its dependencies (like openai, dotenv) are correctly installed/placed.
try:
    from app.agent import Agent 
except ModuleNotFoundError:
    logger.warning("ModuleNotFoundError when trying to import app.agent. Falling back to direct import.", exc_info=True)
    # Fallback if running from a context where 'app.' prefix isn't recognized (e.g. tests directly in app dir)
    from agent import Agent
except ImportError as e:
    logger.error(f"Could not import Agent. Ensure agent_backend/app/agent.py exists and OPENAI_API_KEY is configured. Import error: {e}", exc_info=True)
    # Provide a dummy agent if import fails, so FastAPI can still start for basic checks.
    class Agent:
        async def process_request(self, user_query: str):
            logger.error("Dummy Agent process_request called due to import failure.")
            return {"error": "Agent not properly initialized due to import error."}


app = FastAPI(
    title="Agent Backend Proxy",
    description="An agent backend using FastAPI, UV Python, and OpenAI for multi-tool interactions.",
    version="0.1.0",
    docs_url="/api/docs", # Standardized docs URL
    redoc_url="/api/redoc" # Standardized ReDoc URL
)

# Initialize the agent
# This requires the .env file with OPENAI_API_KEY to be in the `agent_backend` directory,
# which is the parent of the `app` directory where main.py resides.
# The Agent class itself handles load_dotenv().
try:
    agent_instance = Agent()
    logger.info("Agent instance initialized successfully.")
except Exception as e:
    logger.error(f"Failed to initialize Agent: {e}", exc_info=True)
    # If agent initialization fails, the app might still run but /chat endpoint will likely fail.
    # For robustness, you might want a health check endpoint.
    agent_instance = None # Or a fallback agent that returns errors

class ChatRequest(BaseModel):
    user_query: str
    # session_id: str # Optional: for maintaining conversation history per user. Good for future enhancement.

class ChatResponse(BaseModel):
    # Define a more structured response if possible, or keep it flexible with dict
    data: dict # This will contain the agent's processed response.
    message: str = "Processed successfully"

class ErrorResponse(BaseModel):
    detail: str

@app.post("/api/chat", 
          response_model=ChatResponse,
          responses={
              400: {"model": ErrorResponse, "description": "Bad Request"},
              500: {"model": ErrorResponse, "description": "Internal Server Error"}
          },
          summary="Process a user query",
          tags=["Agent Interaction"])
async def chat_endpoint(request: ChatRequest):
    """
    Main chat endpoint to interact with the agent.
    The agent will process the query, potentially use tools, and return a response.
    """
    logger.info(f"Received chat request with query: '{request.user_query}'")
    if not agent_instance:
        logger.error("Agent service not available for /api/chat request.")
        raise HTTPException(status_code=503, detail="Agent service is not available due to initialization error.")

    if not request.user_query.strip(): # Check for empty or whitespace-only query
        logger.warning("Received empty user_query.")
        raise HTTPException(status_code=400, detail="user_query cannot be empty.")

    try:
        # The agent's process_request method will eventually orchestrate tool use
        agent_response_data = await agent_instance.process_request(request.user_query)
        
        if agent_response_data.get("error"):
            error_message = agent_response_data.get("error")
            logger.error(f"Agent returned an error: {error_message}")
            # Consider if agent can distinguish between user errors (4xx) and internal errors (5xx)
            # For now, most agent errors are treated as internal.
            if "OpenAI API key missing or dummy" in error_message: # Specific case
                 raise HTTPException(status_code=503, detail=error_message) # Service Unavailable
            raise HTTPException(status_code=500, detail=error_message)
            
        logger.info(f"Agent processed request successfully. Response data: {agent_response_data}")
        return ChatResponse(data=agent_response_data)
    except HTTPException:
        # Log HTTPExceptions that are explicitly raised (like the ones above)
        # logger.warning(f"HTTPException caught in chat_endpoint: {e.status_code} - {e.detail}", exc_info=False) # No, this would log before it's raised
        raise # Re-raise HTTPException directly
    except Exception as e:
        # Catch-all for other unexpected errors during agent processing
        logger.error(f"Unhandled exception in /api/chat endpoint during agent processing: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"An unexpected error occurred while processing your request.")

@app.get("/api/health", 
         summary="Health check", 
         tags=["Management"])
async def health_check():
    """
    Simple health check endpoint.
    """
    # Basic check, can be expanded (e.g. check OpenAI connectivity if key is present)
    # For now, if agent_instance initialized, consider it healthy enough.
    # A more robust check might involve a quick test call to OpenAI if a key is configured.
    if agent_instance and getattr(agent_instance, 'client', None) and agent_instance.client.api_key and agent_instance.client.api_key != "dummy_key_for_subtask_environment":
        logger.info("Health check: Status - healthy, Agent initialized - True, OpenAI configured - True")
        return {"status": "healthy", "agent_initialized": True, "openai_configured": True}
    elif agent_instance:
        logger.warning("Health check: Status - degraded, Agent initialized - True, OpenAI configured - False. Reason: OpenAI API key may be missing or invalid/dummy.")
        return {"status": "degraded", "agent_initialized": True, "openai_configured": False, "reason": "OpenAI API key may be missing or invalid/dummy."}
    else:
        logger.error("Health check: Status - unhealthy, Agent initialized - False. Reason: Agent instance failed to initialize.")
        return {"status": "unhealthy", "agent_initialized": False, "reason": "Agent instance failed to initialize."}


@app.get("/", include_in_schema=False) # Hide from API docs if it's just a redirect or simple message
async def root_redirect():
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/api/docs") # Redirect to API docs

# To run this app (from agent_backend directory, where .env should be):
# 1. Ensure OPENAI_API_KEY is in .env file.
# 2. Command: uvicorn app.main:app --reload --port 8000
#
# Example .env file in agent_backend directory:
# OPENAI_API_KEY="your_openai_api_key_here"

if __name__ == "__main__":
    # This __main__ block is for direct script execution testing (e.g., python app/main.py)
    # Uvicorn is the standard way to run FastAPI apps.
    import uvicorn
    logger.info("Starting Uvicorn server from __main__ block (for testing purposes)...")
    logger.info(f"Expected .env file location for OPENAI_API_KEY: {project_root}/.env")
    logger.info("If the agent fails to initialize, check that the API key is correctly set there.")
    
    # Uvicorn needs to be told where to find the app instance, relative to the CWD.
    # If running `python agent_backend/app/main.py`, then `main:app` is correct if CWD is `agent_backend/app`.
    # If running `python app/main.py` from `agent_backend`, then `app.main:app` is how uvicorn CLI would see it.
    # For simplicity here, assuming CWD is `agent_backend/app` or `agent_backend` and Python resolves `main:app`.
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True, reload_dirs=[project_root])
