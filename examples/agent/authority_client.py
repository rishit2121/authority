"""A dependency-free client for the Authority runtime API (Python 3.9+, standard library only).

    from authority_client import AuthorityClient

    authority = AuthorityClient(base_url=AUTHORITY_URL, runtime_key=AUTHORITY_RUNTIME_KEY)
    outcome = authority.call(task_id=task_id, tool="github.get_issue", operation="get_issue",
                              resource="owner/repo", arguments={"issue_number": "1"})

Two ways to authenticate, both sent the same way (Authorization: Bearer ...):
pass `runtime_key` (works on every call, any task) or `session_token` (one task,
up to 15 minutes -- see `create_session()`). A session is resolved through the
exact same check a runtime key is; it is a convenience, not a separate trust model.

`call()` asks Authority for permission, then -- only if it was granted -- executes
through Authority's own connector (GitHub tools go through /api/v1/github/execute;
every other registered connector goes through the generic /api/v1/execute). It
returns a small, explicit dict so your agent decides what to do next instead of
guessing:

    {"kind": "done", "data": ...}                    the operation really ran
    {"kind": "wait_for_approval", "status_url": ...}  a human must approve; poll await_approval()
    {"kind": "replan" | "clarify" | "stop", ...}      follow the guidance; never retry the same refused call
    {"kind": "retry_later", ...}                      a temporary condition; retry the SAME request later
    {"kind": "authorized", "capability": ...}         no Authority connector for this tool; your own code
                                                       executes it, using the capability only as proof of permission

Whichever credential you hold is sent only in the Authorization header and is never logged by this module.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

_NEXT_STEPS = {"proceed", "replan", "clarify", "request_approval", "retry_later", "stop"}


class AuthorityError(Exception):
    def __init__(self, message: str, status: Optional[int] = None, code: Optional[str] = None):
        super().__init__(message)
        self.status = status
        self.code = code


@dataclass
class _Response:
    status: int
    ok: bool
    json: dict


@dataclass
class AuthorityClient:
    base_url: str
    runtime_key: Optional[str] = None
    session_token: Optional[str] = None
    timeout_seconds: float = 15.0

    _credential: str = field(init=False, repr=False)

    def __post_init__(self) -> None:
        credential = self.runtime_key or self.session_token
        if not self.base_url or not credential:
            raise ValueError("base_url and either runtime_key or session_token are required")
        self._credential = credential
        self.base_url = self.base_url.rstrip("/")

    def _request(self, method: str, path: str, body: Optional[dict] = None) -> _Response:
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(
            f"{self.base_url}{path}",
            data=data,
            method=method,
            headers={"Authorization": f"Bearer {self._credential}", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_seconds) as res:
                payload = json.loads(res.read() or b"{}")
                return _Response(status=res.status, ok=True, json=payload)
        except urllib.error.HTTPError as err:
            try:
                payload = json.loads(err.read() or b"{}")
            except json.JSONDecodeError:
                payload = {}
            return _Response(status=err.code, ok=False, json=payload)

    def create_session(self, task_id: str, ttl_seconds: Optional[int] = None) -> dict:
        """Exchanges the runtime key for a short-lived, task-scoped session. Requires an active contract."""
        body: dict[str, Any] = {"taskId": task_id}
        if ttl_seconds:
            body["ttlSeconds"] = ttl_seconds
        r = self._request("POST", "/api/v1/sessions", body)
        if not r.ok:
            raise AuthorityError(
                r.json.get("error", {}).get("message", "session creation failed"),
                status=r.status,
                code=r.json.get("error", {}).get("code"),
            )
        return r.json

    def current_session(self) -> dict:
        """Introspects whichever session token this client holds."""
        return self._request("GET", "/api/v1/sessions/current").json

    def revoke_session(self, reason: Optional[str] = None) -> dict:
        """Ends the session this client holds early."""
        return self._request("POST", "/api/v1/sessions/revoke", {"reason": reason} if reason else {}).json

    def fetch_tools(self, task_id: str) -> dict:
        """The exact set of tools this task's active contract currently allows -- convenience, not authority."""
        r = self._request("GET", f"/api/v1/tasks/{task_id}/tools")
        if not r.ok:
            raise AuthorityError(
                r.json.get("error", {}).get("message", "fetching the tool manifest failed"),
                status=r.status,
                code=r.json.get("error", {}).get("code"),
            )
        return r.json

    def authorize(
        self,
        task_id: str,
        tool: str,
        operation: str,
        arguments: Optional[dict] = None,
        resource: Optional[str] = None,
        idempotency_key: Optional[str] = None,
        max_uses: Optional[int] = None,
    ) -> dict:
        """Step 1: ask for permission. A refusal is a normal 200 response with a status, not an exception."""
        body: dict[str, Any] = {
            "taskId": task_id,
            "tool": tool,
            "operation": operation,
            "arguments": arguments or {},
            "idempotencyKey": idempotency_key,
        }
        if resource:
            body["resource"] = resource
        if max_uses:
            body["maxUses"] = max_uses
        r = self._request("POST", "/api/v1/authorize", body)
        if not r.ok:
            raise AuthorityError(
                r.json.get("error", {}).get("message", "authorize failed"),
                status=r.status,
                code=r.json.get("error", {}).get("code"),
            )
        return r.json

    def execute(self, capability: str, tool: str, operation: str, resource: str, arguments: dict,
                idempotency_key: str) -> _Response:
        """Executes any connector-backed tool except GitHub's."""
        return self._request(
            "POST", "/api/v1/execute",
            {"capability": capability, "tool": tool, "operation": operation, "resource": resource,
             "arguments": arguments, "idempotencyKey": idempotency_key},
        )

    def execute_github(self, capability: str, tool: str, operation: str, resource: str, arguments: dict,
                        idempotency_key: str) -> _Response:
        """GitHub keeps its own dedicated execution route; every other tool uses execute() above."""
        return self._request(
            "POST", "/api/v1/github/execute",
            {"capability": capability, "tool": tool, "operation": operation, "resource": resource,
             "arguments": arguments, "idempotencyKey": idempotency_key},
        )

    def approval_status(self, status_url: str) -> dict:
        path = status_url if status_url.startswith("/") else urllib.request.urlparse(status_url).path
        return self._request("GET", path).json

    def await_approval(self, status_url: str, interval_seconds: float = 3.0, max_wait_seconds: float = 600.0,
                        should_stop: Optional[Callable[[], bool]] = None) -> dict:
        """Never resolves to a guess: times out to {"state": "pending", "timed_out": True} rather than assuming success."""
        deadline = time.monotonic() + max_wait_seconds
        while True:
            status = self.approval_status(status_url)
            if status.get("state") and status["state"] != "pending":
                return status
            if time.monotonic() > deadline:
                return {"state": "pending", "timed_out": True}
            if should_stop and should_stop():
                return {"state": "pending", "aborted": True}
            time.sleep(interval_seconds)

    def call(
        self,
        task_id: str,
        tool: str,
        operation: str,
        arguments: Optional[dict] = None,
        resource: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> dict:
        """Authorizes one proposed call and, if allowed, executes it -- never both in one irrevocable step."""
        idempotency_key = idempotency_key or f"{task_id[:8]}-{tool}-{int(time.time() * 1000)}"
        decision = self.authorize(task_id, tool, operation, arguments, resource, idempotency_key)
        guidance = decision.get("guidance") or {}
        next_step = guidance.get("nextStep") if guidance.get("nextStep") in _NEXT_STEPS else "stop"
        message = guidance.get("message") or decision.get("summary") or ""

        if next_step == "request_approval":
            approval = decision.get("approval") or {}
            return {"kind": "wait_for_approval", "status_url": approval.get("statusUrl"), "message": message,
                    "decision": decision, "idempotency_key": idempotency_key}

        capability = (decision.get("capability") or {}).get("token")
        if next_step != "proceed" or not capability:
            return {"kind": "stop" if next_step == "proceed" else next_step, "message": message, "decision": decision}

        dispatch = self.execute_github if tool.startswith("github.") else self.execute
        exec_result = dispatch(capability, tool, operation, resource, arguments or {}, idempotency_key)
        return _outcome_from_execution(exec_result, decision)


def _outcome_from_execution(exec_result: _Response, decision: dict) -> dict:
    if exec_result.ok:
        if exec_result.json.get("replayed"):
            return {
                "kind": "done", "data": None, "replayed": True,
                "message": "This idempotency key already ran; the original response body is not stored. "
                            "Request a new capability to re-read.",
                "receipt_id": exec_result.json.get("receiptId"), "decision": decision,
            }
        return {"kind": "done", "data": exec_result.json.get("data"),
                "receipt_id": exec_result.json.get("receiptId"), "decision": decision}

    code = (exec_result.json.get("error") or {}).get("code", "EXECUTION_FAILED")
    if code == "OPERATION_NOT_SUPPORTED":
        return {"kind": "authorized", "capability": decision.get("capability"),
                "message": "No Authority connector for this tool.", "decision": decision}
    if exec_result.status == 504 or code == "EXECUTION_INDETERMINATE":
        return {"kind": "stop", "message": "The outcome of this write is unknown. Do not retry it; ask a human to check.",
                "code": code, "decision": decision}
    return {"kind": "retry_later" if exec_result.json.get("status") == "released" else "stop",
            "message": f"Execution refused: {code}", "code": code, "decision": decision}
