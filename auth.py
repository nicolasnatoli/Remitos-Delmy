import secrets
from datetime import datetime, timedelta
from functools import wraps

from flask import redirect, request, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash

import database as db

SESSION_TIMEOUT = timedelta(minutes=60)
ROLES = ("admin", "operativo")


def ensure_default_admin():
    if db.has_usuarios():
        return
    password = secrets.token_urlsafe(6)
    db.crear_usuario("admin", generate_password_hash(password), rol="admin")
    print(f"[Depósito] Usuario admin creado. Usuario: admin  Contraseña: {password}")
    print("[Depósito] Cambiala desde 'Cambiar contraseña' apenas ingreses.")


def verify_login(username: str, password: str) -> dict | None:
    user = db.get_usuario(username)
    if not user or not user["activo"]:
        return None
    if not check_password_hash(user["password_hash"], password):
        return None
    return user


def crear_usuario(username: str, password: str, rol: str):
    db.crear_usuario(username, generate_password_hash(password), rol=rol)


def cambiar_password(username: str, password: str):
    db.set_password(username, generate_password_hash(password))


def session_valida() -> bool:
    if not session.get("user"):
        return False
    ultima = session.get("last_active")
    if not ultima:
        return False
    if datetime.utcnow() - datetime.fromisoformat(ultima) > SESSION_TIMEOUT:
        session.clear()
        return False
    session["last_active"] = datetime.utcnow().isoformat()
    return True


def iniciar_sesion(user: dict):
    session["user"] = user["username"]
    session["rol"] = user["rol"]
    session["last_active"] = datetime.utcnow().isoformat()


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session_valida():
            return redirect(url_for("login", timeout=1, next=request.path))
        return view(*args, **kwargs)

    return wrapped


def admin_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session_valida():
            return redirect(url_for("login", timeout=1, next=request.path))
        if session.get("rol") != "admin":
            return "No autorizado", 403
        return view(*args, **kwargs)

    return wrapped
