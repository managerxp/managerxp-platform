import React, { useCallback, useEffect, useRef, useState } from 'react';
import { adminApi, assetUrl, adminAuth, shortDate } from '../../lib/adminApi';
import {
  Page, Panel, Pill, Banner, Skeleton, Empty, Button, Field, Input, Select, Table
} from '../../components/admin/ui';

/*
 * The master Game Catalog — ManagerXP's own.
 *
 * A game and the ways to launch it are two separate levels here, because the
 * same title genuinely exists on several stores at once: F1 25 has a Steam App
 * ID, an Epic config and an EA config, and a station will have exactly one of
 * them installed. So the game carries only what a player recognises — a name,
 * a genre, artwork — and each platform gets its own configuration underneath
 * it holding the App ID, launch target and process name.
 *
 * A café never edits any of that. Its own Game Library selects a title from
 * this list and, per station, ticks which platform config is actually
 * installed there. Fixing a wrong App ID here fixes it for every café.
 *
 * A title in use by at least one café cannot be hard-deleted (the server
 * refuses with 409) — set it Inactive instead. Likewise a platform config a
 * station has installed or a venue account points at.
 */

const PLATFORMS = ['Steam', 'Epic', 'EA', 'Riot', 'Ubisoft', 'Battle.net', 'Rockstar', 'Custom'];

/* Mirrors LAUNCH_METHOD_BY_PLATFORM on the server, only so the operator sees
   the default that is about to be applied rather than an empty box. The server
   fills it in regardless if left blank, so the two can never disagree. */
const LAUNCH_METHOD_BY_PLATFORM = {
  Steam: 'STEAM_URI', Epic: 'EPIC_URI', EA: 'EA_APP', Ubisoft: 'UBISOFT_URI',
  'Battle.net': 'BATTLENET_URI', Riot: 'EXECUTABLE', Rockstar: 'EXECUTABLE', Custom: 'EXECUTABLE'
};

/* What each store actually wants in the "App ID" box, so the operator is not
   guessing which of a launcher's several ids we mean. */
const ID_HINT = {
  Steam: 'Steam appid, e.g. 730', Epic: 'Epic catalog/namespace id',
  EA: 'EA content id', Ubisoft: 'Ubisoft game id', 'Battle.net': 'Product code, e.g. pro',
  Riot: 'Not used — set a launch target instead', Rockstar: 'Not used — set a launch target instead',
  Custom: 'Not used — set a launch target instead'
};

const USES_ID = (p) => !['Riot', 'Rockstar', 'Custom'].includes(p);

const MAX_IMAGE = 8 * 1024 * 1024;
const bytes = (n) => {
  const mb = n / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
};

const emptyGame = { name: '', category: '', description: '', status: 'ACTIVE' };
const emptyPlatform = {
  platform: 'Steam', platform_game_id: '', launch_method: '', launch_target: '',
  process_name: '', launch_arguments: '', status: 'ACTIVE'
};

const GameCard = ({ item, onEdit, onPlatforms, onDelete, mayEdit }) => {
  const logo = assetUrl(item.icon_url);
  const cover = assetUrl(item.banner_url);
  const platforms = item.platforms || [];
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
      <div className="flex aspect-[16/10] items-center justify-center bg-black/40">
        {cover || logo ? (
          <img
            src={cover || logo}
            alt=""
            className="h-full w-full object-cover"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        ) : (
          <span className="text-xs text-neutral-700">no artwork</span>
        )}
      </div>
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-white">{item.name}</div>
            <div className="mt-0.5 text-[10px] text-neutral-600">
              #{item.id}{item.category ? ` · ${item.category}` : ''} · added {shortDate(item.created_at)}
              {item.cafe_count > 0 && ` · ${item.cafe_count} café${item.cafe_count === 1 ? '' : 's'} offering it`}
            </div>
          </div>
          <Pill tone={item.status === 'ACTIVE' ? 'good' : 'mute'}>{item.status}</Pill>
        </div>

        <div className="mt-2 flex flex-wrap gap-1">
          {platforms.length === 0 ? (
            <span className="text-[11px] text-amber-400/80">No platform configured — cafés cannot launch it</span>
          ) : platforms.map((p) => (
            <Pill key={p.id} tone={p.status === 'ACTIVE' ? 'info' : 'mute'}>{p.platform}</Pill>
          ))}
        </div>

        {mayEdit && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Button variant="ghost" className="!px-2 !py-1 !text-xs" onClick={() => onEdit(item)}>Edit</Button>
            <Button variant="ghost" className="!px-2 !py-1 !text-xs" onClick={() => onPlatforms(item)}>
              Platforms ({platforms.length})
            </Button>
            <Button variant="danger" className="!px-2 !py-1 !text-xs" onClick={() => onDelete(item)}>Delete</Button>
          </div>
        )}
      </div>
    </div>
  );
};

/*
 * The platform editor for one game. Kept as its own panel rather than folded
 * into the game form because platforms can only exist once the game does —
 * there is no id to hang them off before that.
 */
const PlatformPanel = ({ game, onClose, onChanged, setNotice }) => {
  const [rows, setRows] = useState(game.platforms || []);
  const [editing, setEditing] = useState(null);   // null | {} for new | the row
  const [form, setForm] = useState(emptyPlatform);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    const fresh = await adminApi.catalogGame(game.id);
    setRows(fresh.platforms || []);
    onChanged(fresh);
  }, [game.id, onChanged]);

  const openNew = () => {
    const taken = new Set(rows.map((r) => r.platform));
    const free = PLATFORMS.find((p) => !taken.has(p)) || 'Custom';
    setEditing({});
    setForm({ ...emptyPlatform, platform: free, launch_method: LAUNCH_METHOD_BY_PLATFORM[free] });
  };

  const openEdit = (row) => {
    setEditing(row);
    setForm({
      platform: row.platform,
      platform_game_id: row.platform_game_id || '',
      launch_method: row.launch_method || '',
      launch_target: row.launch_target || '',
      process_name: row.process_name || '',
      launch_arguments: row.launch_arguments || '',
      status: row.status
    });
  };

  const setField = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const onPlatformChange = (e) => {
    const platform = e.target.value;
    setForm((f) => ({
      ...f,
      platform,
      /* Only re-suggest the launch method while it still matches the previous
         platform's default — never overwrite something typed by hand. */
      launch_method: Object.values(LAUNCH_METHOD_BY_PLATFORM).includes(f.launch_method) || !f.launch_method
        ? LAUNCH_METHOD_BY_PLATFORM[platform]
        : f.launch_method
    }));
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      const payload = {
        platform: form.platform,
        platform_game_id: form.platform_game_id.trim() || null,
        launch_method: form.launch_method.trim() || null,
        launch_target: form.launch_target.trim() || null,
        process_name: form.process_name.trim() || null,
        launch_arguments: form.launch_arguments.trim() || null,
        status: form.status
      };
      if (editing.id) await adminApi.updateCatalogPlatform(game.id, editing.id, payload);
      else await adminApi.createCatalogPlatform(game.id, payload);

      setEditing(null);
      await refresh();
      setNotice({ tone: 'good', text: `${form.platform} configuration saved for ${game.name}.` });
    } catch (err) {
      setNotice({ tone: 'bad', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const destroy = async (row) => {
    if (!window.confirm(`Remove the ${row.platform} configuration for ${game.name}?`)) return;
    try {
      await adminApi.deleteCatalogPlatform(game.id, row.id);
      await refresh();
      setNotice({ tone: 'good', text: `${row.platform} configuration removed.` });
    } catch (err) {
      /* 409 while a station has it installed or a venue account points at it —
         that message already explains the way out, so just show it. */
      setNotice({ tone: 'bad', text: err.message });
    }
  };

  return (
    <Panel
      title={`Platforms for ${game.name}`}
      description="One configuration per store this title ships on. A café's station picks whichever of these it actually has installed, so the same game can run from Steam on one PC and EA on another."
    >
      <div className="mb-4 flex gap-2">
        {!editing && <Button className="!px-3 !py-1.5 !text-xs" onClick={openNew}>Add platform</Button>}
        <Button variant="ghost" className="!px-3 !py-1.5 !text-xs" onClick={onClose}>Done</Button>
      </div>

      {editing && (
        <form onSubmit={save} className="mb-4 space-y-4 rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Platform" id="pf-platform">
              <Select id="pf-platform" value={form.platform} onChange={onPlatformChange} disabled={!!editing.id}>
                {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
              </Select>
            </Field>
            <Field label="App ID" id="pf-app-id" hint={ID_HINT[form.platform]}>
              <Input id="pf-app-id" className="font-mono" value={form.platform_game_id}
                     onChange={setField('platform_game_id')}
                     placeholder={USES_ID(form.platform) ? '730' : '—'} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Launch method" id="pf-method" hint="Left blank, the server fills in this platform's default.">
              <Input id="pf-method" className="font-mono" value={form.launch_method}
                     onChange={setField('launch_method')} placeholder={LAUNCH_METHOD_BY_PLATFORM[form.platform]} />
            </Field>
            <Field label="Launch target / executable" id="pf-target"
                   hint="What runs when there is no store protocol to hand off to (Riot, Rockstar, Custom).">
              <Input id="pf-target" className="font-mono" value={form.launch_target}
                     onChange={setField('launch_target')} placeholder="C:\\Riot Games\\Riot Client\\RiotClientServices.exe" />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Process name" id="pf-process" hint="Watched to know when the game has closed.">
              <Input id="pf-process" className="font-mono" value={form.process_name}
                     onChange={setField('process_name')} placeholder="cs2.exe" />
            </Field>
            <Field label="Status" id="pf-status" hint="Inactive configs stay on record but stop being offered.">
              <Select id="pf-status" value={form.status} onChange={setField('status')}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </Select>
            </Field>
          </div>

          <Field label="Launch arguments" id="pf-args" hint="Optional — passed on to the game.">
            <Input id="pf-args" className="font-mono" value={form.launch_arguments}
                   onChange={setField('launch_arguments')} placeholder="-fullscreen -novid" />
          </Field>

          <div className="flex gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : editing.id ? 'Save platform' : 'Add configuration'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button>
          </div>
        </form>
      )}

      {rows.length === 0 ? (
        <Empty
          title="No platform configured yet"
          text="Until this game has at least one platform, no café can launch it. Add the store it ships on and its App ID."
          action={<Button onClick={openNew}>Add platform</Button>}
        />
      ) : (
        <Table columns={['Platform', 'App ID', 'Launch method', 'Target / process', 'Status', '']}>
          {rows.map((r) => (
            <tr key={r.id} className="text-neutral-300">
              <td className="px-4 py-3 font-medium text-white">{r.platform}</td>
              <td className="px-4 py-3 font-mono text-xs">{r.platform_game_id || <span className="text-neutral-700">—</span>}</td>
              <td className="px-4 py-3 font-mono text-xs">{r.launch_method || <span className="text-neutral-700">—</span>}</td>
              <td className="px-4 py-3">
                <div className="max-w-[260px] truncate font-mono text-xs">{r.launch_target || <span className="text-neutral-700">—</span>}</div>
                <div className="font-mono text-[10px] text-neutral-600">{r.process_name || ''}</div>
              </td>
              <td className="px-4 py-3"><Pill tone={r.status === 'ACTIVE' ? 'good' : 'mute'}>{r.status}</Pill></td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-1.5">
                  <Button variant="ghost" className="!px-2 !py-1 !text-xs" onClick={() => openEdit(r)}>Edit</Button>
                  <Button variant="danger" className="!px-2 !py-1 !text-xs" onClick={() => destroy(r)}>Remove</Button>
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Panel>
  );
};

const GameCatalog = () => {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [editing, setEditing] = useState(null);       // null | {} for new | the row
  const [platformsFor, setPlatformsFor] = useState(null);
  const [form, setForm] = useState(emptyGame);
  const [saving, setSaving] = useState(false);
  const [logoFile, setLogoFile] = useState(null);
  const [coverFile, setCoverFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [coverPreview, setCoverPreview] = useState(null);
  const logoRef = useRef(null);
  const coverRef = useRef(null);

  const mayEdit = adminAuth.can('catalogue.manage');

  const load = useCallback(() => {
    adminApi.gameCatalog({ limit: 500 })
      .then((data) => { setItems(data || []); setError(null); })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => () => {
    if (logoPreview?.startsWith('blob:')) URL.revokeObjectURL(logoPreview);
    if (coverPreview?.startsWith('blob:')) URL.revokeObjectURL(coverPreview);
  }, [logoPreview, coverPreview]);

  const openNew = () => {
    setEditing({});
    setPlatformsFor(null);
    setForm(emptyGame);
    setLogoFile(null); setCoverFile(null);
    setLogoPreview(null); setCoverPreview(null);
    setNotice(null);
  };

  const openEdit = (item) => {
    setEditing(item);
    setPlatformsFor(null);
    setForm({
      name: item.name,
      category: item.category || '',
      description: item.description || '',
      status: item.status
    });
    setLogoFile(null); setCoverFile(null);
    setLogoPreview(assetUrl(item.icon_url));
    setCoverPreview(assetUrl(item.banner_url));
    setNotice(null);
  };

  const openPlatforms = (item) => {
    setEditing(null);
    setPlatformsFor(item);
    setNotice(null);
  };

  /* Keep the card grid and the open platform panel showing the same rows
     without a full reload — the panel already has the fresh game in hand. */
  const applyGame = useCallback((fresh) => {
    setItems((list) => (list || []).map((g) => (g.id === fresh.id ? { ...g, ...fresh } : g)));
    setPlatformsFor((cur) => (cur && cur.id === fresh.id ? { ...cur, ...fresh } : cur));
  }, []);

  const setField = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const pickImage = (kind) => (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > MAX_IMAGE) {
      setNotice({ tone: 'bad', text: `That image is ${bytes(f.size)}. The limit is 8 MB.` });
      e.target.value = '';
      return;
    }
    const url = URL.createObjectURL(f);
    if (kind === 'logo') {
      if (logoPreview?.startsWith('blob:')) URL.revokeObjectURL(logoPreview);
      setLogoFile(f); setLogoPreview(url);
    } else {
      if (coverPreview?.startsWith('blob:')) URL.revokeObjectURL(coverPreview);
      setCoverFile(f); setCoverPreview(url);
    }
    setNotice(null);
  };

  const save = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return setNotice({ tone: 'bad', text: 'Give the game a name' });

    setSaving(true);
    setNotice(null);
    try {
      const payload = {
        name: form.name.trim(),
        category: form.category.trim() || null,
        description: form.description.trim() || null,
        status: form.status
      };

      const isNew = !editing.id;
      const saved = isNew
        ? await adminApi.createCatalogGame(payload)
        : await adminApi.updateCatalogGame(editing.id, payload);

      if (logoFile) await adminApi.uploadCatalogLogo(saved.id, logoFile);
      if (coverFile) await adminApi.uploadCatalogCover(saved.id, coverFile);

      setEditing(null);
      load();

      if (isNew) {
        /* A game with no platform cannot be launched by anyone, so go straight
           to that step rather than leaving it silently unusable. */
        setPlatformsFor({ ...saved, platforms: [] });
        setNotice({ tone: 'good', text: `${payload.name} added. Now add the platform it launches from.` });
      } else {
        setNotice({ tone: 'good', text: `${payload.name} saved. Every café's catalog picks this up on its next refresh.` });
      }
    } catch (err) {
      setNotice({ tone: 'bad', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const destroy = async (item) => {
    if (!window.confirm(`Delete ${item.name} from the catalog? Its platform configurations go with it.`)) return;
    try {
      await adminApi.deleteCatalogGame(item.id);
      if (platformsFor?.id === item.id) setPlatformsFor(null);
      load();
      setNotice({ tone: 'good', text: `${item.name} deleted.` });
    } catch (e) {
      /* The server refuses with 409 while a café still has it selected — that
         message already says to use Inactive instead, so just surface it. */
      setNotice({ tone: 'bad', text: e.message });
    }
  };

  return (
    <Page
      title="Game Catalog"
      lede="The single source of truth for every game a café can offer. A game holds the name and artwork; each store it ships on gets its own launch configuration underneath it. A café only selects from this list — it never configures any of this itself."
      actions={mayEdit && <Button onClick={openNew}>Add game</Button>}
    >
      {error && <Banner tone="bad">{error}</Banner>}
      {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}

      {editing && (
        <Panel
          title={editing.id ? `Edit ${editing.name}` : 'Add a game'}
          description="Just what a player sees. How it actually launches is set per platform, once this game exists."
        >
          <form onSubmit={save} className="grid gap-4 lg:grid-cols-[220px_1fr]">
            <div className="space-y-3">
              <div>
                <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black/40">
                  {logoPreview
                    ? <img src={logoPreview} alt="" className="h-full w-full object-cover" />
                    : <span className="text-xs text-neutral-700">no logo</span>}
                </div>
                <Button type="button" variant="ghost" className="mt-2 w-full" onClick={() => logoRef.current?.click()}>
                  {logoPreview ? 'Change logo' : 'Choose logo'}
                </Button>
                <input ref={logoRef} type="file" accept="image/*" hidden onChange={pickImage('logo')} />
                <p className="mt-1 text-[11px] text-neutral-600">Square icon, PNG or JPG, up to 8 MB</p>
              </div>
              <div>
                <div className="flex aspect-[16/10] items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black/40">
                  {coverPreview
                    ? <img src={coverPreview} alt="" className="h-full w-full object-cover" />
                    : <span className="text-xs text-neutral-700">no cover</span>}
                </div>
                <Button type="button" variant="ghost" className="mt-2 w-full" onClick={() => coverRef.current?.click()}>
                  {coverPreview ? 'Change cover' : 'Choose cover'}
                </Button>
                <input ref={coverRef} type="file" accept="image/*" hidden onChange={pickImage('cover')} />
                <p className="mt-1 text-[11px] text-neutral-600">Wide box art, up to 8 MB</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Game name" id="gc-name">
                  <Input id="gc-name" value={form.name} onChange={setField('name')}
                         placeholder="Counter-Strike 2" autoFocus />
                </Field>
                <Field label="Category" id="gc-category">
                  <Input id="gc-category" value={form.category} onChange={setField('category')} placeholder="FPS" />
                </Field>
              </div>

              <Field label="Description" id="gc-description" hint="Optional — shown to customers picking a game.">
                <textarea
                  id="gc-description"
                  rows={3}
                  className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white placeholder-neutral-600 outline-none focus:border-white/25"
                  value={form.description}
                  onChange={setField('description')}
                  placeholder="A tactical shooter…"
                />
              </Field>

              <Field label="Status" id="gc-status" hint="Inactive titles drop off every café's “add a game” list without affecting cafés already offering them.">
                <Select id="gc-status" value={form.status} onChange={setField('status')}>
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                </Select>
              </Field>

              <div className="flex gap-2">
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving…' : editing.id ? 'Save game' : 'Add to catalog'}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setEditing(null)} disabled={saving}>
                  Cancel
                </Button>
                {editing.id && (
                  <Button type="button" variant="ghost" onClick={() => openPlatforms(editing)} disabled={saving}>
                    Platforms ({(editing.platforms || []).length})
                  </Button>
                )}
              </div>
            </div>
          </form>
        </Panel>
      )}

      {platformsFor && (
        <PlatformPanel
          key={platformsFor.id}
          game={platformsFor}
          onClose={() => { setPlatformsFor(null); load(); }}
          onChanged={applyGame}
          setNotice={setNotice}
        />
      )}

      {!items ? <Skeleton rows={2} height="h-40" />
        : items.length === 0 ? (
          <Empty
            title="The catalog is empty"
            text="Add a game and every café will be able to select it for their library."
            action={mayEdit ? <Button onClick={openNew}>Add game</Button> : null}
          />
        ) : (
          <>
            <p className="text-xs text-neutral-500">
              {items.length} title{items.length === 1 ? '' : 's'} in the catalog ·{' '}
              {items.reduce((n, g) => n + (g.platforms?.length || 0), 0)} platform configurations.
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {items.map((g) => (
                <GameCard
                  key={g.id}
                  item={g}
                  mayEdit={mayEdit}
                  onEdit={openEdit}
                  onPlatforms={openPlatforms}
                  onDelete={destroy}
                />
              ))}
            </div>
          </>
        )}
    </Page>
  );
};

export default GameCatalog;
