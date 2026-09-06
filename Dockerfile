FROM python:3.11-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 libosmesa6 libgomp1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY physics.py serve.py ./
ENV MUJOCO_GL=disable
ENV PYTHONUNBUFFERED=1
EXPOSE 8787
CMD ["python", "serve.py", "--host", "0.0.0.0", "--port", "8787", "--no-open"]
