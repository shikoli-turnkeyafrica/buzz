import { PRODUCT_NAME } from "@/brand";
import { RecoveryScreen } from "./RecoveryScreen";

export function RelaunchRequiredScreen() {
  return (
    <RecoveryScreen
      testId="relaunch-required"
      title={`Restart ${PRODUCT_NAME} to finish recovery`}
      body={`Your identity was updated. ${PRODUCT_NAME} needs to restart so syncing and agents run under it.`}
    />
  );
}
