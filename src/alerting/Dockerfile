FROM registry.access.redhat.com/ubi9/python-311:latest

WORKDIR /app

RUN pip install requests==2.32.5 llama-stack-client==0.2.12

COPY alerting/ .

CMD ["python3", "alert_receiver.py"]
