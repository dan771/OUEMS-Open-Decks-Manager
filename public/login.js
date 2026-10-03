const form = document.querySelector("#login-form");
const error = document.querySelector("#login-error");
const submit = document.querySelector("#login-submit");
let setup = false;
try {
  const response = await fetch("/api/auth/status", { cache: "no-store" });
  const status = await response.json();
  if (!response.ok) throw new Error(status.error);
  if (!status.initialized) {
    setup = true;
    document.querySelector("#login-title").textContent =
      "Create the administrator account";
    document.querySelector("#login-description").textContent =
      "Choose your login to start managing Open Decks.";
    document.querySelector("#setup-name").hidden = false;
    document.querySelector("#login-password").autocomplete = "new-password";
    document.querySelector("#setup-key").hidden = !status.setupKeyRequired;
    document.querySelector("#setup-token").required = status.setupKeyRequired;
    document.querySelector("#password-help").textContent =
      "Use a unique password of at least 12 characters. You can create Manager and Viewer accounts after signing in.";
    submit.textContent = "Create account & sign in";
    if (!status.setupAvailable)
      throw new Error(
        "Administrator setup is not enabled. Ask the deployment owner to configure ADMIN_SETUP_TOKEN.",
      );
  }
} catch (e) {
  error.textContent = e.message || "Cannot reach the app.";
  error.hidden = false;
  submit.disabled = true;
}
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  submit.disabled = true;
  error.hidden = true;
  try {
    const response = await fetch(
      setup ? "/api/auth/setup" : "/api/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      },
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Cannot sign in.");
    window.location.replace("/");
  } catch (e) {
    error.textContent = e.message;
    error.hidden = false;
    submit.disabled = false;
  }
});
