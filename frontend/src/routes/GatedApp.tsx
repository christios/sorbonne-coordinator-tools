import { SignInGate } from "@/components/SignInGate";
import { App } from "@/routes/App";

/** The application, with the sign-in gate in front of it. */
export function GatedApp() {
  return (
    <SignInGate>
      <App />
    </SignInGate>
  );
}
