from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db, utcnow
from ..deps import Principal, get_principal, require_user
from ..models import User, UserSession
from ..ratelimit import enforce
from ..schemas import (
    AuthOut,
    ChangePasswordIn,
    DeleteAccountIn,
    LoginIn,
    MeOut,
    RegisterIn,
    UsageOut,
    user_out,
)
from ..security import SESSION_PREFIX, burn_password_check, hash_password, hash_token, new_token, verify_password
from ..services import delete_user, user_quota, user_usage

router = APIRouter(prefix="/api/auth", tags=["accounts"])


def _accounts_on():
    if not get_settings().accounts_enabled:
        raise HTTPException(404, "Accounts are disabled on this server.")


def _new_session(db: Session, user: User) -> str:
    token = new_token(SESSION_PREFIX)
    db.add(UserSession(user_id=user.id, token_hash=hash_token(token),
                       expires_at=utcnow() + timedelta(days=get_settings().session_ttl_days)))
    db.commit()
    return token


@router.post("/register", status_code=201, response_model=AuthOut)
def register(body: RegisterIn, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    _accounts_on()
    s = get_settings()
    if not s.registration_open:
        raise HTTPException(403, "New registrations are currently closed.")
    enforce(f"auth:ip:{p.ip}", s.rl_auth_per_minute, 60, "Too many attempts")
    email = str(body.email).strip().lower()
    user = User(email=email, password_hash=hash_password(body.password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "An account with this email already exists. Try signing in.")
    return AuthOut(user=user_out(user), token=_new_session(db, user))


@router.post("/login", response_model=AuthOut)
def login(body: LoginIn, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    _accounts_on()
    s = get_settings()
    email = body.email.strip().lower()
    enforce(f"auth:ip:{p.ip}", s.rl_auth_per_minute, 60, "Too many sign-in attempts")
    enforce(f"auth:email:{hash_token(email)[:24]}", s.rl_auth_per_minute, 300, "Too many sign-in attempts")
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        burn_password_check(body.password)
        raise HTTPException(401, "Incorrect email or password.")
    if not verify_password(user.password_hash, body.password) or user.disabled:
        raise HTTPException(401, "Incorrect email or password.")
    return AuthOut(user=user_out(user), token=_new_session(db, user))


@router.post("/logout", status_code=204)
def logout(p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    if p.session is not None:
        db.delete(p.session)
        db.commit()
    return Response(status_code=204)


@router.get("/me", response_model=MeOut)
def me(user: User = Depends(require_user), db: Session = Depends(get_db)):
    usage = user_usage(db, user.id)
    return MeOut(user=user_out(user), usage=UsageOut(quota_bytes=user_quota(user), **usage))


@router.post("/change-password", status_code=204)
def change_password(body: ChangePasswordIn, p: Principal = Depends(get_principal),
                    user: User = Depends(require_user), db: Session = Depends(get_db)):
    enforce(f"auth:ip:{p.ip}", get_settings().rl_auth_per_minute, 60, "Too many attempts")
    if not verify_password(user.password_hash, body.current_password):
        raise HTTPException(400, "Your current password is incorrect.")
    user.password_hash = hash_password(body.new_password)
    db.execute(delete(UserSession).where(UserSession.user_id == user.id, UserSession.id != p.session.id))
    db.commit()
    return Response(status_code=204)


@router.delete("/me", status_code=204)
def delete_account(body: DeleteAccountIn, p: Principal = Depends(get_principal),
                   user: User = Depends(require_user), db: Session = Depends(get_db)):
    enforce(f"auth:ip:{p.ip}", get_settings().rl_auth_per_minute, 60, "Too many attempts")
    if not verify_password(user.password_hash, body.password):
        raise HTTPException(400, "Password is incorrect.")
    delete_user(db, user)
    return Response(status_code=204)
