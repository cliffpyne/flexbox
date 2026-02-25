FROM python:3.11-slim
WORKDIR /app
COPY backend/ai-dispatch/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ai-dispatch/ .
# Force the environment to see the current directory
ENV PYTHONPATH=/app
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
