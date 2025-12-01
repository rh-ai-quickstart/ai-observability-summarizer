FROM registry.access.redhat.com/ubi9/python-311:latest
WORKDIR /app

# Copy required dependencies that UI imports (build context is src/)
COPY core/ /app/core/
COPY common/ /app/common/
COPY chatbots/ /app/chatbots/

# Copy UI specific files
COPY ui/ui.py .
COPY ui/mcp_client_helper.py .
COPY ui/mcp_client_adapter.py .
COPY ui/error_handler.py .
COPY ui/requirements.txt .

# Fix matplotlib cache permission issue
ENV MPLCONFIGDIR=/tmp/matplotlib

RUN pip install --no-cache-dir -r requirements.txt
EXPOSE 8501
CMD ["streamlit", "run", "ui.py", "--server.port=8501", "--server.address=0.0.0.0"]