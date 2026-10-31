"use client";
import {useEffect, useState} from "react";
import {ChevronLeft} from "lucide-react";
import {Empty, ModelAvatar, Notice, PageHeader, PageSkeleton, Segmented, TableError} from "@/components/bh/ui";
import {label, linkIds} from "@/lib/bh";
import {useModels, useTable} from "@/lib/tables";
import {APP_LABEL, appOfSource, CUPID_APPS, cupidIds, ratio} from "@/lib/convos";
import {Charts, FOOTNOTE, forecastOf, type Grain, GRAINS, MonthStepper, monthTotal, n, pct, realStacks, settled, Summary, useCupid, useSubs} from "@/views/convos/board";

// One model: the same stats and charts as the Convo Tracker, scoped to its Cupid creator IDs and OF accounts.
export default function ModelConvos({id}: {id: string}) {
  const [month, setMonth] = useState<string | null>(null), [now, setNow] = useState(""), [today, setToday] = useState("");
  useEffect(() => { const d = new Date().toISOString().slice(0, 10); setToday(d); setNow(d.slice(0, 7)); setMonth(d.slice(0, 7)); }, []);
  const [grain, setGrain] = useState<Grain>("day");
  const models = useModels(), map = useTable("map");
  const live = models.rows.filter(m => label(m.fields.status) !== "Ended").sort((a, b) => label(a.fields.model).localeCompare(label(b.fields.model)));
  const model = models.rows.find(m => m.id === id), name = model ? label(model.fields.model) : "";
  const ids = cupidIds(model?.fields.cupidId), apps = CUPID_APPS.filter(a => ids[a]);
  const accounts = map.rows.filter(r => linkIds(r.fields.model).includes(id)), slugs = [...new Set(accounts.map(r => label(r.fields.slug)).filter(Boolean))];
  const cupid = useCupid(apps.map(app => ({app, creator: ids[app]})), month, grain);
  const subs = useSubs(slugs, month, grain);

  if (!month || models.loading || map.loading) return <PageSkeleton/>;
  const back = <a href="/convos" className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground"><ChevronLeft className="size-4"/>Convo Tracker</a>;
  if (!model) return <div className="space-y-6">{back}{models.error ? <TableError tables={[models, map]}/> : <Empty title="Model not found">It may have been removed from Creatorstaq.</Empty>}</div>;

  const cupidError = cupid.find(s => s.error)?.error, subsError = subs.find(s => s.error)?.error;
  const used = monthTotal(cupid, "charged"), conv = monthTotal(cupid, "conversions");
  const real = slugs.length ? settled(subs, ms => ms.reduce((a, s) => a + (s.newSubs ?? 0), 0)) : null;
  const fromCupid = settled(subs, ms => ms.reduce((a, s) => a + Object.entries(s.bySource).reduce((b, [src, c]) => b + (apps.includes(appOfSource(src)!) ? c : 0), 0), 0));

  return <div className="space-y-6">
    {back}
    <PageHeader eyebrow="Convo Tracker · Model" title={<span className="flex items-center gap-3"><ModelAvatar name={name} src={accounts.find(r => r.fields.avatar)?.fields.avatar} index={Math.max(0, live.indexOf(model))} size={36}/>{name}</span> as any}
      subtitle={<>{apps.length ? apps.map(a => `${APP_LABEL[a]} ${ids[a]}`).join(" · ") : "No Cupid creator IDs yet"}{accounts.length > 0 && " · " + accounts.map(r => "@" + (label(r.fields.ofUsername) || label(r.fields.slug))).join(" · ")}</>}
      actions={<MonthStepper month={month} now={now} onChange={setMonth}/>}/>
    {cupidError && <Notice tone="red">Cupid: {cupidError.message}</Notice>}
    {subsError && <Notice tone="amber">Creatorstaq: {subsError.message}</Notice>}
    {!apps.length && <Notice tone="gray">Add this model's Cupid creator IDs on the Convo Tracker to see its convos.</Notice>}

    <Segmented size="sm" value={grain} options={GRAINS} onChange={setGrain}/>
    <Summary month={month} used={used} conv={conv} real={real}
      realSub={!slugs.length ? "No OnlyFans account linked" : `${fromCupid === undefined ? "…" : n(fromCupid)} from Cupid platforms · Cupid claims ${pct(ratio(conv, fromCupid))}`}
      fc={month === now && apps.length ? cupid.map(s => ({app: s.app, fc: forecastOf(s, month, today) || undefined})) : null}/>
    <Charts grain={grain} month={month} today={today} by="platform"
      cupid={cupid.map(s => ({key: s.app, label: APP_LABEL[s.app], color: `var(--app-${s.app})`, s}))} cupidLoading={cupid.some(s => s.pending)}
      real={slugs.length ? realStacks(apps, subs, grain) : null} realLoading={subs.some(s => s.pending)} realEmpty={slugs.length ? "No real subs in this window." : "No OnlyFans account linked."}/>

    <p className="text-[12px] leading-relaxed text-[var(--text-faint)]">{FOOTNOTE}</p>
  </div>;
}
