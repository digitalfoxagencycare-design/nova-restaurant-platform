import { useMemo, useState } from "react";
import { api, niceError, useLoad } from "../lib/api";
import { href } from "../lib/router";
import { ErrorBox, Icon, LinkButton, Page, Skeleton, Empty, Button, cx } from "../ui";
import { RestaurantCard } from "./common";

const FILTERS = [{ id: "all", label: "All" }, { id: "active", label: "Active" }, { id: "suspended", label: "Paused" }];

export default function Restaurants() {
  const q = useLoad(() => api.get("/v2/platform/tenants"));
  const [text, setText] = useState("");
  const [status, setStatus] = useState("all");
  const list = useMemo(() => {
    const s = text.trim().toLowerCase();
    return (q.data || []).filter((t) => (status === "all" || t.status === status) && (!s || t.name.toLowerCase().includes(s) || t.slug.includes(s) || (t.owner_email || "").toLowerCase().includes(s)));
  }, [q.data, text, status]);

  return (
    <Page
      title="Restaurants"
      subtitle="Every client restaurant on Nova."
      actions={<LinkButton variant="primary" href={href("/restaurants/new")}><Icon name="plus" className="h-4 w-4" />Add a restaurant</LinkButton>}
    >
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <label htmlFor="rsearch" className="sr-only">Search restaurants</label>
          <span className="pointer-events-none absolute left-3 top-3 text-ink/50"><Icon name="search" /></span>
          <input id="rsearch" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search by name, code or owner e-mail" className="min-h-[44px] w-full rounded-xl border border-line bg-white pl-10 pr-3 text-[15px]" />
        </div>
        <div role="group" aria-label="Show" className="flex gap-1 rounded-xl bg-white p-1 ring-1 ring-line">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" aria-pressed={status === f.id} onClick={() => setStatus(f.id)} className={cx("min-h-[40px] rounded-lg px-4 text-[15px] font-semibold", status === f.id ? "bg-brand text-brand-on" : "hover:bg-brand-soft")}>{f.label}</button>
          ))}
        </div>
      </div>
      {q.loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-36" />)}</div>
      ) : q.error ? (
        <ErrorBox text={niceError(q.error)} onRetry={q.retry} />
      ) : q.data.length === 0 ? (
        <Empty icon="store" title="No restaurants yet" hint="Add your first client. We will walk you through it step by step." action={<LinkButton variant="primary" href={href("/restaurants/new")}>Add a restaurant</LinkButton>} />
      ) : list.length === 0 ? (
        <Empty icon="search" title="No restaurant matches" hint="Try a different word, or show all restaurants." action={<Button variant="secondary" onClick={() => { setText(""); setStatus("all"); }}>Clear the search</Button>} />
      ) : (
        <>
          <p className="mb-2 text-[14px] text-ink/70" role="status">{list.length} restaurant{list.length === 1 ? "" : "s"}</p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{list.map((t) => <RestaurantCard key={t.id} t={t} />)}</div>
        </>
      )}
    </Page>
  );
}
