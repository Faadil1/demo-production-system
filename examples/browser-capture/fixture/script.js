document.querySelector('[data-testid="verify-button"]').addEventListener("click", () => {
  document.querySelector('[data-testid="state-text"]').textContent = "Verification complete.";
  document.querySelector('[data-testid="result-card"]').classList.remove("hidden");
});
