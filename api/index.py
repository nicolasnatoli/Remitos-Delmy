# Puente para Vercel: el runtime de Python busca el entrypoint dentro de
# api/, así que esto solo re-exporta la app de Flask que vive en app.py (el
# archivo real, el que se usa también para correr localmente).
from app import app
