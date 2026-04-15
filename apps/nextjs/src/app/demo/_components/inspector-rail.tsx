// @ts-nocheck
import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  CheckSquare,
  Coffee,
  Clock,
  ExternalLink,
  MapPin,
  Pencil,
  Plus,
  Receipt,
  Square,
  UtensilsCrossed,
} from 'lucide-react'
import {
  getDependencyPrompts,
  getEntitySummary,
  getEntityTitle,
  getLinkedEntities,
  getLocationForEntity,
  getRouteForEntity,
  getTasksForEntity,
} from './trip-model'

function pillClasses(tone) {
  switch (tone) {
    case 'done':
    case 'Go':
    case 'Settled':
      return 'border-[#3FB950]/30 bg-[#3FB950]/10 text-[#3FB950]'
    case 'Watch':
    case 'Pending':
    case 'open':
      return 'border-[#D29922]/30 bg-[#D29922]/10 text-[#D29922]'
    case 'Assigned':
    case 'Transit':
    case 'Friday Arrival':
      return 'border-[#58A6FF]/30 bg-[#58A6FF]/10 text-[#58A6FF]'
    default:
      return 'border-[#30363D] bg-[#0d1117] text-[#C9D1D9]'
  }
}

function SectionTitle({ eyebrow, title, meta }) {
  return (
    <div className="mb-3">
      {eyebrow ? (
        <div className="mb-1 text-[9px] font-black uppercase tracking-[0.18em] text-[#58A6FF]">
          {eyebrow}
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[12px] font-black uppercase tracking-[0.12em] text-[#C9D1D9]">
          {title}
        </h3>
        {meta ? <div className="text-[10px] font-bold text-[#8B949E]">{meta}</div> : null}
      </div>
    </div>
  )
}

function StatusPill({ label }) {
  return (
    <span
      className={`inline-flex items-center rounded-[2px] border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${pillClasses(label)}`}
    >
      {label}
    </span>
  )
}

function DetailRow({ label, value }) {
  if (!value) return null
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[#30363D]/30 py-2 text-[11px] last:border-b-0">
      <span className="text-[#8B949E]">{label}</span>
      <span className="text-right text-[#C9D1D9]">{value}</span>
    </div>
  )
}

function TaskRow({ task, onToggle }) {
  const done = task.status === 'done'
  return (
    <button
      type="button"
      onClick={() => onToggle(task.id)}
      className="flex w-full items-center justify-between border-b border-[#30363D]/30 px-3 py-3 text-left text-[11px] text-[#C9D1D9] transition-colors last:border-b-0 hover:bg-[#1f2a34]/50"
    >
      <div>
        <div className="font-medium">{task.title}</div>
        <div className="text-[10px] text-[#8B949E]">{task.dayId?.toUpperCase()}</div>
      </div>
      <span
        className={`flex h-5 w-5 items-center justify-center border ${
          done ? 'border-[#3FB950] bg-[#3FB950]/15 text-[#3FB950]' : 'border-[#30363D] text-[#8B949E]'
        }`}
      >
        {done ? <Check size={12} /> : null}
      </span>
    </button>
  )
}

function ActionChip({ icon: Icon, label, onClick, tone = 'default' }) {
  const tones = {
    default: 'border-[#30363D] bg-[#0d1117] text-[#C9D1D9] hover:border-[#58A6FF]/40 hover:text-[#58A6FF]',
    success: 'border-[#3FB950]/30 bg-[#3FB950]/10 text-[#3FB950] hover:border-[#3FB950]',
    warning: 'border-[#D29922]/30 bg-[#D29922]/10 text-[#D29922] hover:border-[#D29922]',
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 border px-3 py-2 text-[10px] font-black uppercase tracking-wider transition-colors ${tones[tone] || tones.default}`}
    >
      <Icon size={13} />
      {label}
    </button>
  )
}

function PhotoTile({ media }) {
  return (
    <a
      href={media.sourceUrl || media.imageUrl}
      target="_blank"
      rel="noreferrer"
      className="group block overflow-hidden border border-[#30363D] bg-[#161b22]"
    >
      {media.imageUrl ? (
        <div
          className="h-24 w-full bg-cover bg-center transition-transform duration-300 group-hover:scale-[1.03]"
          style={{ backgroundImage: `url(${media.imageUrl})` }}
        />
      ) : null}
      <div className="flex items-center justify-between gap-3 px-3 py-2 text-[10px] font-bold text-[#C9D1D9]">
        <span>{media.label}</span>
        <ExternalLink size={12} className="text-[#58A6FF]" />
      </div>
    </a>
  )
}

function getStopVisual(stop) {
  const stopType = (stop.stopType || '').toLowerCase()
  if (stopType.includes('lunch')) {
    return {
      icon: UtensilsCrossed,
      tone: 'text-[#D29922] border-[#D29922]/30 bg-[#D29922]/10',
      eyebrow: 'Lunch anchor',
    }
  }
  if (stopType.includes('break')) {
    return {
      icon: Coffee,
      tone: 'text-[#58A6FF] border-[#58A6FF]/30 bg-[#58A6FF]/10',
      eyebrow: 'Reset stop',
    }
  }
  return {
    icon: MapPin,
    tone: 'text-[#8B949E] border-[#30363D] bg-[#0d1117]',
    eyebrow: 'Drive stop',
  }
}

function getStopMeta(stop) {
  const items = []
  if (stop.rating) {
    const reviews = stop.userRatingsTotal ? ` · ${stop.userRatingsTotal} reviews` : ''
    items.push(`${stop.rating.toFixed(1)} rating${reviews}`)
  }
  if (Array.isArray(stop.openingHours) && stop.openingHours.length) {
    items.push(stop.openingHours[0])
  }
  if (stop.phoneNumber) {
    items.push(stop.phoneNumber)
  }
  return items
}

function DriveStopEditor({ stop, onSelectEntity, onUpdateLocationFields }) {
  const [isEditing, setIsEditing] = useState(false)
  const visual = getStopVisual(stop)
  const StopIcon = visual.icon
  const photo = [...(stop.livePhotos || []), ...(stop.photos || [])].find((item) => item?.imageUrl)
  const metaItems = getStopMeta(stop)

  return (
    <div className="border-b border-[#30363D]/30 px-4 py-4 last:border-b-0">
      <div className="overflow-hidden rounded-[2px] border border-[#30363D] bg-[#0d1117]">
        <div className="flex items-center justify-between gap-3 border-b border-[#30363D]/40 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[9px] font-black uppercase tracking-[0.18em] text-[#8B949E]">
              {visual.eyebrow}
            </div>
            <div className="mt-1 text-[10px] font-black uppercase tracking-[0.18em] text-[#D29922]">
              {stop.stopType || 'Drive stop'}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setIsEditing((current) => !current)}
              className="inline-flex items-center gap-1 border border-[#30363D] bg-[#161b22] px-2.5 py-1.5 text-[9px] font-black uppercase tracking-wider text-[#C9D1D9] transition-colors hover:border-[#58A6FF]/40 hover:text-[#58A6FF]"
            >
              <Pencil size={11} />
              {isEditing ? 'Done' : 'Edit'}
            </button>
            <button
              type="button"
              onClick={() => onSelectEntity('location', stop.id)}
              className="text-[9px] font-black uppercase tracking-wider text-[#58A6FF]"
            >
              Inspect
            </button>
          </div>
        </div>

        <div className="relative min-h-[196px] border-b border-[#30363D]/40">
          <div className="absolute inset-0">
            {photo ? (
              <div
                className="h-full w-full bg-cover bg-center"
                style={{ backgroundImage: `url(${photo.imageUrl})` }}
              />
            ) : (
              <div className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_top_left,rgba(88,166,255,0.14),transparent_42%),linear-gradient(180deg,#121922,#0c1117)]">
                <StopIcon size={30} className={visual.tone.split(' ')[0]} />
              </div>
            )}
          </div>
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(8,10,15,0.18),rgba(8,10,15,0.7)_55%,rgba(8,10,15,0.95))]" />
          <div className="relative flex h-full flex-col justify-between p-4">
            <div className="flex items-start justify-between gap-3">
              <div className={`inline-flex h-12 w-12 shrink-0 items-center justify-center border shadow-[0_10px_24px_rgba(0,0,0,0.28)] ${visual.tone}`}>
                <StopIcon size={18} />
              </div>
              {photo?.label ? (
                <div className="max-w-[55%] border border-black/20 bg-black/35 px-2 py-1 text-right text-[9px] font-bold uppercase tracking-[0.14em] text-[#C9D1D9] backdrop-blur-[2px]">
                  {photo.label}
                </div>
              ) : null}
            </div>
            <div className="max-w-[82%]">
              <div className="text-[11px] font-black uppercase tracking-[0.18em] text-[#D29922]">
                {stop.stopType || 'Drive stop'}
              </div>
              <div className="mt-2 text-[20px] font-black leading-tight text-[#F0F6FC]">
                {stop.title}
              </div>
              <div className="mt-3 max-w-[420px] text-[12px] leading-relaxed text-[#C9D1D9]">
                {stop.summary || 'Road-trip intel pending for this stop.'}
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-3 p-4">
          {stop.address ? (
            <div className="flex items-start gap-3 border border-[#30363D] bg-[#11161d] px-3 py-3">
              <MapPin size={13} className="mt-0.5 shrink-0 text-[#58A6FF]" />
              <div>
                <div className="text-[9px] font-black uppercase tracking-[0.16em] text-[#8B949E]">
                  Location
                </div>
                <div className="mt-1 text-[11px] leading-relaxed text-[#C9D1D9]">{stop.address}</div>
              </div>
            </div>
          ) : null}

          {metaItems.length ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {metaItems.map((item) => (
                <div
                  key={item}
                  className="border border-[#30363D] bg-[#161b22] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[#C9D1D9]"
                >
                  {item}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {isEditing ? (
          <div className="grid gap-2 border-t border-[#30363D]/50 bg-[#0b1016] p-4">
            <input
              value={stop.title || ''}
              onChange={(event) => onUpdateLocationFields(stop.id, { title: event.target.value })}
              placeholder="Stop name"
              className="border border-[#30363D] bg-[#161b22] px-3 py-2 text-[11px] text-[#C9D1D9] outline-none focus:border-[#58A6FF]"
            />
            <input
              value={stop.placesQuery || stop.address || ''}
              onChange={(event) =>
                onUpdateLocationFields(stop.id, {
                  placesQuery: event.target.value,
                  placeId: null,
                  websiteUrl: null,
                  phoneNumber: null,
                  rating: null,
                  userRatingsTotal: null,
                  openingHours: null,
                  livePhotos: [],
                })
              }
              placeholder="Address or place query"
              className="border border-[#30363D] bg-[#161b22] px-3 py-2 text-[11px] text-[#C9D1D9] outline-none focus:border-[#58A6FF]"
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default function InspectorRail({
  doc,
  pageId,
  selection,
  activeFamilyId,
  onSelectEntity,
  onUpdateLocationFields,
  onToggleTask,
  onUpdateEntityNote,
  onAddTask,
  onConvertNoteToTask,
  onToggleMealStatus,
  onToggleExpenseSettled,
}) {
  const entity = useMemo(() => {
    const collectionName = selection ? {
      family: 'families',
      location: 'locations',
      route: 'routes',
      itineraryItem: 'itineraryItems',
      meal: 'meals',
      activity: 'activities',
      stayItem: 'stayItems',
      expense: 'expenses',
      task: 'tasks',
    }[selection.type] : null

    return collectionName ? doc[collectionName]?.find((item) => item.id === selection.id) || null : null
  }, [doc, selection])

  const [quickTask, setQuickTask] = useState('')
  const [recentlyUpdated, setRecentlyUpdated] = useState(false)
  const tasks = useMemo(() => getTasksForEntity(doc, entity), [doc, entity])
  const linkedEntities = useMemo(() => getLinkedEntities(doc, entity), [doc, entity])
  const location = useMemo(() => getLocationForEntity(doc, entity), [doc, entity])
  const route = useMemo(() => getRouteForEntity(doc, entity), [doc, entity])
  const routeOwner = useMemo(
    () => (entity?.type === 'route' ? doc.families.find((family) => family.id === entity.familyId) || null : null),
    [doc.families, entity],
  )
  const activeFamily = useMemo(
    () => doc.families.find((family) => family.id === activeFamilyId) || null,
    [activeFamilyId, doc.families],
  )
  const lastEditedByFamily = useMemo(
    () => doc.families.find((family) => family.id === entity?.lastEditedByFamilyId) || null,
    [doc.families, entity?.lastEditedByFamilyId],
  )
  const prompts = useMemo(() => getDependencyPrompts(doc, entity), [doc, entity])
  const driveStops = useMemo(() => {
    const stopIds =
      entity?.plannedStopIds ||
      route?.stopLocationIds ||
      []

    const explicitStops = stopIds
      .map((locationId) => doc.locations.find((location) => location.id === locationId))
      .filter(Boolean)

    if (explicitStops.length) return explicitStops

    return linkedEntities.filter((item) => item.type === 'location' && item.stopType)
  }, [doc.locations, entity?.plannedStopIds, linkedEntities, route?.stopLocationIds])

  if (!entity) {
    return (
      <aside className="flex w-[360px] flex-col border-l border-[#30363D] bg-[#161b22]">
        <div className="border-b border-[#30363D] bg-[#1f2a34] p-5">
          <div className="text-[12px] font-black uppercase tracking-[0.14em] text-[#C9D1D9]">
            Inspector
          </div>
        </div>
        <div className="p-5 text-[11px] leading-relaxed text-[#8B949E]">
          Select any timeline block, map location, meal, activity, expense, or family to inspect and edit it here.
        </div>
      </aside>
    )
  }

  const taskCompletion = tasks.length ? `${tasks.filter((task) => task.status === 'done').length}/${tasks.length}` : '0/0'
  const detailRows = [
    'window' in entity && entity.window ? ['Window', entity.window] : null,
    'timeLabel' in entity && entity.timeLabel ? ['Timing', entity.timeLabel] : null,
    'origin' in entity && entity.origin ? ['Origin', entity.origin] : null,
    'originAddress' in entity && entity.originAddress ? ['Origin detail', entity.originAddress] : null,
    'driveTime' in entity && entity.driveTime ? ['Drive time', entity.driveTime] : null,
    'eta' in entity && entity.eta ? ['ETA', entity.eta] : null,
    'vehicle' in entity && entity.vehicle ? ['Vehicle', entity.vehicle] : null,
    'vehicleLabel' in entity && entity.vehicleLabel ? ['Call sign', entity.vehicleLabel] : null,
    'responsibility' in entity && entity.responsibility ? ['Task package', entity.responsibility] : null,
    'owner' in entity && entity.owner ? ['Owner', entity.owner] : null,
    'reservationType' in entity && entity.reservationType ? ['Mode', entity.reservationType] : null,
    'payer' in entity && entity.payer ? ['Payer', entity.payer] : null,
    'split' in entity && entity.split ? ['Split', entity.split] : null,
    'amount' in entity && entity.amount ? ['Amount', `$${entity.amount}`] : null,
    routeOwner?.originAddress ? ['Origin detail', routeOwner.originAddress] : null,
    routeOwner?.vehicleLabel ? ['Call sign', routeOwner.vehicleLabel] : null,
    route ? ['Route', route.title] : null,
    location ? ['Location', location.title] : null,
  ].filter(Boolean)
  const externalTarget = entity.type === 'location' ? entity : location
  const compactStayMode = pageId === 'stay'
  const compactMealsMode = pageId === 'meals'
  const compactActivitiesMode = pageId === 'activities'
  const compactRailMode = compactStayMode || compactMealsMode || compactActivitiesMode
  const familyDriveMode = entity.type === 'family' && driveStops.length > 0
  const actionChips = []

  useEffect(() => {
    setRecentlyUpdated(true)
    const timerId = window.setTimeout(() => setRecentlyUpdated(false), 700)
    return () => window.clearTimeout(timerId)
  }, [selection?.id, selection?.type])

  if (entity.type === 'meal') {
    actionChips.push({
      icon: CheckSquare,
      label: entity.status === 'Assigned' ? 'Mark pending' : 'Mark assigned',
      onClick: () => onToggleMealStatus(entity.id),
      tone: entity.status === 'Assigned' ? 'warning' : 'success',
    })
  }
  if (entity.type === 'expense') {
    actionChips.push({
      icon: Receipt,
      label: entity.settled ? 'Mark open' : 'Mark settled',
      onClick: () => onToggleExpenseSettled(entity.id),
      tone: entity.settled ? 'warning' : 'success',
    })
  }
  if (entity.type === 'task') {
    actionChips.push({
      icon: entity.status === 'done' ? Square : CheckSquare,
      label: entity.status === 'done' ? 'Mark open' : 'Mark done',
      onClick: () => onToggleTask(entity.id),
      tone: entity.status === 'done' ? 'warning' : 'success',
    })
  }
  if (location && entity.type !== 'location') {
    actionChips.push({
      icon: MapPin,
      label: 'Inspect location',
      onClick: () => onSelectEntity('location', location.id),
    })
  }
  if (externalTarget?.externalUrl) {
    actionChips.push({
      icon: ExternalLink,
      label: 'Open external',
      onClick: () => window.open(externalTarget.externalUrl, '_blank', 'noreferrer'),
    })
  }

  return (
    <aside className={`relative flex min-h-0 ${compactMealsMode || compactActivitiesMode ? 'w-[320px]' : 'w-[360px]'} flex-col overflow-hidden border-l border-[#30363D] bg-[#161b22]`}>
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 z-10 h-1 bg-[#58A6FF] transition-all duration-500 ${
          recentlyUpdated ? 'opacity-100 shadow-[0_0_22px_rgba(88,166,255,0.55)]' : 'opacity-0'
        }`}
      />
      <div
        className={`border-b border-[#30363D] bg-[#1f2a34] p-5 transition-[box-shadow,background-color,transform] duration-500 ${
          recentlyUpdated
            ? 'bg-[#243243] shadow-[inset_0_0_0_1px_rgba(88,166,255,0.24),0_0_28px_rgba(88,166,255,0.08)]'
            : ''
        }`}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="mb-1 text-[9px] font-black uppercase tracking-[0.2em] text-[#58A6FF]">
              {entity.type}
            </div>
            <h2 className="text-[15px] font-black uppercase tracking-[0.12em] text-[#C9D1D9]">
              {getEntityTitle(entity)}
            </h2>
            <div className="mt-1 text-[11px] text-[#8B949E]">{getEntitySummary(entity)}</div>
          </div>
          {'status' in entity && entity.status ? <StatusPill label={entity.status} /> : null}
        </div>

        <div className="mb-3 grid grid-cols-2 gap-2">
          <div className="border border-[#30363D] bg-[#0d1117] px-3 py-2 text-center">
            <div className="mb-1 text-[8px] font-black uppercase tracking-widest text-[#8B949E]">Checklist</div>
            <div className="text-[13px] font-black text-[#C9D1D9]">{taskCompletion}</div>
          </div>
          <div className="border border-[#30363D] bg-[#0d1117] px-3 py-2 text-center">
            <div className="mb-1 text-[8px] font-black uppercase tracking-widest text-[#8B949E]">Day</div>
            <div className="text-[13px] font-black text-[#C9D1D9]">{entity.dayId ? entity.dayId.toUpperCase() : 'ALL'}</div>
          </div>
        </div>

        {actionChips.length ? (
          <div className="flex flex-wrap gap-2">
            {actionChips.map((action) => (
              <ActionChip
                key={action.label}
                icon={action.icon}
                label={action.label}
                onClick={action.onClick}
                tone={action.tone}
              />
            ))}
          </div>
        ) : null}
      </div>

      <div
        className={`flex-1 space-y-5 overflow-y-auto bg-[#0d1117] p-5 transition-[transform,opacity] duration-300 ${
          recentlyUpdated ? 'translate-y-[1px]' : ''
        }`}
      >
        {familyDriveMode ? (
          <section className="border border-[#30363D] bg-[#161b22]">
            <div className="border-b border-[#30363D] px-4 py-3">
              <SectionTitle eyebrow="Road Trip" title="Inbound stop plan" meta={`${driveStops.length} stop${driveStops.length > 1 ? 's' : ''}`} />
            </div>
            <div className="border-b border-[#30363D]/30 px-4 py-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="border border-[#30363D] bg-[#0d1117] px-3 py-2">
                  <div className="text-[8px] font-black uppercase tracking-widest text-[#8B949E]">Origin</div>
                  <div className="mt-1 text-[11px] text-[#C9D1D9]">{entity.origin}</div>
                </div>
                <div className="border border-[#30363D] bg-[#0d1117] px-3 py-2">
                  <div className="text-[8px] font-black uppercase tracking-widest text-[#8B949E]">Arrival target</div>
                  <div className="mt-1 text-[11px] text-[#C9D1D9]">{entity.eta}</div>
                </div>
              </div>
              <div className="mt-3 text-[11px] leading-relaxed text-[#8B949E]">{entity.routeSummary}</div>
            </div>
            {driveStops.map((stop) => (
              <DriveStopEditor
                key={stop.id}
                stop={stop}
                onSelectEntity={onSelectEntity}
                onUpdateLocationFields={onUpdateLocationFields}
              />
            ))}
          </section>
        ) : null}

        <section className="border border-[#30363D] bg-[#161b22] p-4">
          <SectionTitle
            eyebrow={compactRailMode ? 'Selected item' : 'Briefing'}
            title={
              compactMealsMode
                ? 'Context snapshot'
                : compactActivitiesMode
                  ? 'Mission snapshot'
                : compactStayMode
                  ? 'Why this matters'
                  : 'What matters here'
            }
          />
          <div className="space-y-2 text-[11px] text-[#C9D1D9]">
            {'riskLevel' in entity && entity.riskLevel ? (
              <div className="flex items-center gap-2">
                <AlertTriangle size={13} className="text-[#D29922]" />
                <span>Risk watch: {entity.riskLevel}</span>
              </div>
            ) : null}
            {('window' in entity && entity.window) || ('timeLabel' in entity && entity.timeLabel) ? (
              <div className="flex items-center gap-2">
                <Clock size={13} className="text-[#58A6FF]" />
                <span>{entity.window || entity.timeLabel}</span>
              </div>
            ) : null}
            {'summary' in entity && entity.summary ? <div className="leading-relaxed text-[#8B949E]">{entity.summary}</div> : null}
            {'routeSummary' in entity && entity.routeSummary ? (
              <div className="leading-relaxed text-[#8B949E]">{entity.routeSummary}</div>
            ) : null}
            {'description' in entity && entity.description ? <div className="leading-relaxed text-[#8B949E]">{entity.description}</div> : null}
            {'backup' in entity && entity.backup ? (
              <div className="rounded-[2px] border border-[#30363D] bg-[#0d1117] px-3 py-2 text-[#8B949E]">
                <span className="font-black uppercase tracking-wider text-[#D29922]">Fallback:</span> {entity.backup}
              </div>
            ) : null}
          </div>
          {!compactRailMode ? (
            <div className="mt-4 space-y-0 border-t border-[#30363D]/50 pt-3">
              {detailRows.length ? detailRows.map(([label, value]) => (
                <DetailRow key={label} label={label} value={value} />
              )) : (
                <div className="text-[11px] text-[#8B949E]">No additional logistics attached.</div>
              )}
            </div>
          ) : null}
        </section>

        {(compactStayMode || compactActivitiesMode) && detailRows.length ? (
          <section className="border border-[#30363D] bg-[#161b22] p-4">
            <SectionTitle eyebrow="Details" title={compactActivitiesMode ? 'Activity intel' : 'Selected item intel'} />
            <div className="space-y-0">
              {detailRows.map(([label, value]) => (
                <DetailRow key={label} label={label} value={value} />
              ))}
            </div>
          </section>
        ) : null}

        {(entity.type === 'family' || entity.type === 'itineraryItem' || entity.type === 'route') && driveStops.length && !familyDriveMode ? (
          <section className="border border-[#30363D] bg-[#161b22]">
            <div className="border-b border-[#30363D] px-4 py-3">
              <SectionTitle eyebrow="Drive Plan" title="Planned stops" meta={`${driveStops.length} stop${driveStops.length > 1 ? 's' : ''}`} />
            </div>
            {driveStops.map((stop) => (
              <DriveStopEditor
                key={stop.id}
                stop={stop}
                onSelectEntity={onSelectEntity}
                onUpdateLocationFields={onUpdateLocationFields}
              />
            ))}
          </section>
        ) : null}

        {!compactMealsMode && !compactActivitiesMode && !familyDriveMode ? (
          <section className="border border-[#30363D] bg-[#161b22]">
            <div className="border-b border-[#30363D] px-4 py-3">
              <SectionTitle eyebrow="Checklist" title="Planning tasks" meta={taskCompletion} />
            </div>
            <div className="p-4">
              {prompts.length ? (
                <div className="mb-4 space-y-2">
                  {prompts.slice(0, 2).map((prompt) => (
                    <div key={prompt.id} className="rounded-[2px] border border-[#30363D] bg-[#0d1117] px-3 py-2 text-[11px] text-[#C9D1D9]">
                      <div className="font-bold">{prompt.label}</div>
                      <div className="mt-1 text-[10px] text-[#8B949E]">{prompt.reason}</div>
                    </div>
                  ))}
                </div>
              ) : null}
              {tasks.length ? (
                <div className="-mx-4 mb-4 border-y border-[#30363D]">
                  {tasks.map((task) => (
                    <TaskRow key={task.id} task={task} onToggle={onToggleTask} />
                  ))}
                </div>
              ) : (
                <div className="mb-4 text-[11px] text-[#8B949E]">
                  No linked tasks yet. Add one below if this item needs follow-up.
                </div>
              )}
              <div className="flex gap-2">
                <input
                  value={quickTask}
                  onChange={(event) => setQuickTask(event.target.value)}
                  placeholder="Add a task tied to this item..."
                  className="flex-1 border border-[#30363D] bg-[#0d1117] px-3 py-2 text-[11px] text-[#C9D1D9] outline-none focus:border-[#58A6FF]"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!quickTask.trim()) return
                    onAddTask(entity.type, entity.id, quickTask.trim())
                    setQuickTask('')
                  }}
                  className="border border-[#30363D] bg-[#0d1117] px-3 py-2 text-[10px] font-black uppercase tracking-wider text-[#C9D1D9] transition-colors hover:border-[#58A6FF]/40 hover:text-[#58A6FF]"
                >
                  Add
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {location && !compactRailMode ? (
          <section className="border border-[#30363D] bg-[#161b22] p-4">
            <SectionTitle eyebrow="Location Intel" title={location.title} />
            <div className="mb-3 space-y-2 text-[11px] text-[#C9D1D9]">
              <div className="flex items-start gap-2">
                <MapPin size={13} className="mt-0.5 text-[#58A6FF]" />
                <span>{location.address}</span>
              </div>
              {location.checkIn || location.checkOut ? (
                <div className="rounded-[2px] border border-[#30363D] bg-[#0d1117] px-3 py-2">
                  {location.checkIn ? <div className="text-[#C9D1D9]">Check-in: {location.checkIn}</div> : null}
                  {location.checkOut ? <div className="mt-1 text-[#C9D1D9]">Check-out: {location.checkOut}</div> : null}
                </div>
              ) : null}
              {location.reservationNote ? <div className="text-[#8B949E]">{location.reservationNote}</div> : null}
              {location.accessNote ? <div className="text-[#8B949E]">{location.accessNote}</div> : null}
              {location.directionsNote ? <div className="text-[#8B949E]">{location.directionsNote}</div> : null}
              {location.lockNote ? <div className="text-[#8B949E]">{location.lockNote}</div> : null}
              {location.parkingNote ? <div className="text-[#8B949E]">{location.parkingNote}</div> : null}
              {location.vehicleFee ? <div className="text-[#8B949E]">Gate fee: {location.vehicleFee}</div> : null}
              {location.wifiNetwork || location.wifiPassword ? (
                <div className="rounded-[2px] border border-[#30363D] bg-[#0d1117] px-3 py-2">
                  {location.wifiNetwork ? <div className="text-[#C9D1D9]">WiFi: {location.wifiNetwork}</div> : null}
                  {location.wifiPassword ? <div className="mt-1 text-[#C9D1D9]">Password: {location.wifiPassword}</div> : null}
                </div>
              ) : null}
              {location.hostName || location.coHostName ? (
                <div className="text-[#8B949E]">
                  Host: {location.hostName}
                  {location.coHostName ? ` • Co-host: ${location.coHostName}` : ''}
                </div>
              ) : null}
              {location.guestSummary ? <div className="text-[#8B949E]">Guests: {location.guestSummary}</div> : null}
              {location.confirmationCode ? <div className="text-[#8B949E]">Confirmation: {location.confirmationCode}</div> : null}
            </div>
            <div className="mb-3 grid grid-cols-2 gap-3">
              {(location.photos || []).slice(0, 2).map((media) => (
                <PhotoTile key={media.id} media={media} />
              ))}
            </div>
            {location.manualUrl ? (
              <div className="flex gap-2">
                <ActionChip
                  icon={ExternalLink}
                  label="House manual"
                  onClick={() => window.open(location.manualUrl, '_blank', 'noreferrer')}
                />
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="border border-[#30363D] bg-[#161b22] p-4">
          <SectionTitle
            eyebrow="Notes"
            title={
              compactMealsMode
                ? 'Planning notes'
                : compactActivitiesMode
                  ? 'Activity notes'
                  : 'Decisions and context'
            }
          />
          {(activeFamily || lastEditedByFamily) ? (
            <div className="mb-3 border border-[#30363D]/60 bg-[#0d1117] px-3 py-2 text-[10px] text-[#8B949E]">
              {activeFamily ? (
                <span>
                  Editing as <span className="font-bold text-[#C9D1D9]">{activeFamily.title}</span>
                </span>
              ) : null}
              {activeFamily && lastEditedByFamily ? ' · ' : null}
              {lastEditedByFamily ? (
                <span>
                  Last edited by <span className="font-bold text-[#C9D1D9]">{lastEditedByFamily.title}</span>
                </span>
              ) : null}
            </div>
          ) : null}
          <textarea
            value={entity.note || ''}
            onChange={(event) => onUpdateEntityNote(entity.type, entity.id, event.target.value)}
            placeholder={
              compactMealsMode
                ? 'Capture decisions, venue-specific notes, or quick follow-ups that belong beside the Meals page intel...'
                : compactActivitiesMode
                  ? 'Capture detailed notes, options to research, kid-specific constraints, or a more opinionated plan for this activity...'
                : 'Capture planning notes, constraints, decisions, or reminders...'
            }
            className="min-h-24 w-full resize-none border border-[#30363D] bg-[#0d1117] px-3 py-2 text-[11px] leading-relaxed text-[#C9D1D9] outline-none focus:border-[#58A6FF]"
          />
          <div className="mt-3 flex gap-2">
            <ActionChip
              icon={Plus}
              label="Note to task"
              onClick={() => onConvertNoteToTask(entity.type, entity.id)}
            />
          </div>
        </section>
      </div>
    </aside>
  )
}

