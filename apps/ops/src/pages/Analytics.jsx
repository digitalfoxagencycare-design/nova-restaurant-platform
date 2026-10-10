import Drill from "../components/Drill";
import { Page } from "../ui";

/** Every restaurant together. Click anything on the charts to look inside it. */
export default function Analytics() {
  return (
    <Page title="Analytics" subtitle="Sales across all your restaurants. Click a slice, bar or name to look inside it, layer by layer, down to a single bill.">
      <Drill defaultBy="restaurant" />
    </Page>
  );
}
