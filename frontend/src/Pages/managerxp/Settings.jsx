import React, { useCallback, useEffect, useState } from 'react';
import { adminApi, adminAuth } from '../../lib/adminApi';
import {
  Page, Panel, Banner, Skeleton, Button, Field, Input, Select, Pill
} from '../../components/admin/ui';

/*
 * Platform settings — the values ManagerXP itself runs on.
 *
 * Not a café's configuration. Those live in the same table but a different
 * scope, and neither API can reach the other's rows.
 *
 * Secrets are write-only: the form shows whether one is stored and can replace
 * it, never reveal it. An empty secret field therefore means "leave it alone",
 * which is what stops someone blanking the SMTP password by saving a form that
 * never showed it to them.
 */

const SettingRow = ({ s, value, onChange }) => {
  const id = `set-${s.key}`;
  const shown = value !== undefined ? value : (s.value ?? '');

  if (s.type === 'boolean') {
    return (
      <Field label={s.description || s.key} id={id} hint={s.key}>
        <Select id={id} value={String(shown)} onChange={(e) => onChange(s.key, e.target.value)}>
          <option value="true">On</option>
          <option value="false">Off</option>
        </Select>
      </Field>
    );
  }

  if (s.is_secret) {
    return (
      <Field
        label={s.description || s.key}
        id={id}
        hint={s.is_set ? 'A value is stored — leave blank to keep it' : 'Not set'}
      >
        <Input
          id={id} type="password" autoComplete="new-password"
          value={value ?? ''}
          onChange={(e) => onChange(s.key, e.target.value)}
          placeholder={s.is_set ? '••••••••' : ''}
        />
      </Field>
    );
  }

  return (
    <Field label={s.description || s.key} id={id} hint={s.key}>
      <Input
        id={id}
        type={s.type === 'number' ? 'number' : 'text'}
        value={shown}
        onChange={(e) => onChange(s.key, e.target.value)}
      />
    </Field>
  );
};

const Settings = () => {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({});
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const mayEdit = adminAuth.can('settings.edit');

  const load = useCallback(() => {
    adminApi.settings()
      .then((d) => { setData(d); setDraft({}); setError(null); })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const change = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
  const dirty = Object.keys(draft).length > 0;

  const save = async () => {
    setSaving(true); setNotice(null);
    try {
      const r = await adminApi.saveSettings(draft);
      load();
      setNotice({
        tone: r.errors?.length ? 'warn' : 'good',
        text: r.errors?.length ? `Saved, but: ${r.errors.join('; ')}` : 'Settings saved'
      });
    } catch (e) { setNotice({ tone: 'bad', text: e.message }); }
    finally { setSaving(false); }
  };

  const test = async () => {
    const to = window.prompt(
      'Send a test email to which address?\n\n' +
      'Save your SMTP settings first — this uses what is stored, not what is on screen.',
      adminAuth.admin()?.email || ''
    );
    if (!to?.trim()) return;
    setTesting(true); setNotice(null);
    try {
      const r = await adminApi.testEmail(to.trim());
      setNotice({ tone: 'good', text: r.message });
    } catch (e) { setNotice({ tone: 'bad', text: e.message }); }
    finally { setTesting(false); }
  };

  if (error) return <Page title="Settings"><Banner tone="bad">{error}</Banner></Page>;
  if (!data) return <Page title="Settings"><Skeleton rows={4} height="h-32" /></Page>;

  return (
    <Page
      title="Settings"
      lede="How ManagerXP itself behaves. These are the platform's values — each café configures its own separately."
      actions={mayEdit && (
        <Button onClick={save} disabled={!dirty || saving}>
          {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
        </Button>
      )}
    >
      {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}

      {!data.mail_configured && (
        <Banner tone="warn">
          No SMTP host is set, so nothing is emailed. Payment links and invoices are still created —
          you just have to pass them on yourself. Fill in the Email section below to change that.
        </Banner>
      )}

      {data.groups.map((g) => (
        <Panel key={g.key} title={g.label} description={g.lede}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {g.settings.map((s) => (
              <SettingRow key={s.key} s={s} value={draft[s.key]} onChange={change} />
            ))}
          </div>

          {g.key === 'mail' && (
            <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-white/10 pt-4">
              <Button variant="ghost" onClick={test} disabled={testing}>
                {testing ? 'Sending…' : 'Send a test email'}
              </Button>
              {/* Stated because it is the commonest confusion: the test uses
                  what is saved, not what is currently typed. */}
              <span className="text-xs text-neutral-500">
                Uses the saved settings. Save first if you have just changed something.
              </span>
              {data.mail_configured
                ? <Pill tone="good">configured</Pill>
                : <Pill tone="warn">not configured</Pill>}
            </div>
          )}
        </Panel>
      ))}

      {mayEdit && (
        <div className="flex gap-2">
          <Button onClick={save} disabled={!dirty || saving}>
            {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
          </Button>
          {dirty && <Button variant="ghost" onClick={() => setDraft({})}>Discard</Button>}
        </div>
      )}

      <p className="text-xs text-neutral-600">
        Changing a trial setting affects trials started from now on. Customers already on a trial
        keep the length they were given — shortening it retroactively would end somebody's trial
        without warning.
      </p>
    </Page>
  );
};

export default Settings;
