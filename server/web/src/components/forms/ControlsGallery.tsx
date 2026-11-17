import { useRef, useState, type FormEvent } from 'react';
import { Icon, type IconSize } from '../icon/Icon.tsx';
import { ICON_PATHS, type IconName } from '../icon/icon-paths.ts';
import { Button } from './Button.tsx';
import { IconButton } from './IconButton.tsx';
import { Select } from './Select.tsx';
import { Textarea } from './Textarea.tsx';
import { TextInput } from './TextInput.tsx';
import type { ButtonVariant } from './button-model.ts';
import { focusFirstInvalid } from './field-model.ts';
import './controls-gallery.css';

const VARIANTS: readonly ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger', 'invite'];
const ICON_SIZES: readonly IconSize[] = ['tiny', 'small', 'body', 'reading'];
const ICON_NAMES = Object.keys(ICON_PATHS) as IconName[];

/**
 * Button, IconButton, the fields and Icon, every state on one page (LAI-1204),
 * so they can be reviewed — and driven by `test/browser/controls.test.ts` —
 * without finding a screen that happens to show each one.
 *
 * **Its own chunk**, as the other galleries are: it reaches the browser only
 * when `/design/states` asks for it.
 *
 * The long labels are deliberate (the break-ui pass): a translated label, an
 * unbroken compound, a script with no spaces, a count in the millions. A
 * button that only ever saw "Save" has not been tested.
 */
export default function ControlsGallery() {
  return (
    <section className="cg" data-controls-gallery aria-labelledby="cg-title">
      <h2 id="cg-title" className="t-title">
        Controls
      </h2>
      <Variants />
      <States />
      <Density />
      <WorstCase />
      <Fields />
      <Icons />
    </section>
  );
}

function Variants() {
  return (
    <div className="cg-block">
      <h3 className="cg-head">Variants and sizes</h3>
      {(['md', 'sm'] as const).map((size) => (
        <div className="cg-row" key={size} data-cg-size={size}>
          {VARIANTS.map((variant) => (
            <Button key={variant} variant={variant} size={size}>
              {variant[0]?.toUpperCase() + variant.slice(1)}
            </Button>
          ))}
          <Button variant="secondary" size={size} icon="plus">
            New task
          </Button>
          <IconButton icon="close" label={`Close (${size})`} size={size} />
          <IconButton icon="gear" label={`Settings (${size})`} variant="secondary" size={size} />
        </div>
      ))}
    </div>
  );
}

function States() {
  const [busy, setBusy] = useState(false);
  const [presses, setPresses] = useState(0);
  const [iconBusy, setIconBusy] = useState(false);

  return (
    <div className="cg-block">
      <h3 className="cg-head">States</h3>
      <div className="cg-row">
        <Button
          busy={busy}
          data-cg="busy"
          onClick={() => {
            setPresses((n) => n + 1);
            setBusy(true);
          }}
        >
          Save changes
        </Button>
        <Button
          variant="ghost"
          data-cg="settle"
          onClick={() => {
            setBusy(false);
            setIconBusy(false);
          }}
        >
          Finish saving
        </Button>
        <output className="cg-note" data-cg-presses={presses}>
          Pressed {presses} {presses === 1 ? 'time' : 'times'}
        </output>
      </div>
      <div className="cg-row">
        <IconButton
          icon="trash"
          label="Remove row"
          variant="danger"
          busy={iconBusy}
          data-cg="icon-busy"
          onClick={() => {
            setIconBusy(true);
          }}
        />
        <Button disabled data-cg="disabled">
          Publish
        </Button>
        <Button
          variant="danger"
          disabled
          disabledReason="Only the space owner can delete it."
          data-cg="reason"
          onClick={() => {
            setPresses((n) => n + 100);
          }}
        >
          Delete space
        </Button>
      </div>
    </div>
  );
}

function Density() {
  return (
    <div className="cg-block">
      <h3 className="cg-head">Compact density</h3>
      <div className="cg-row" data-density="compact" data-cg-density="compact">
        <Button size="md">Save</Button>
        <Button size="sm" variant="secondary">
          Filter
        </Button>
        <IconButton icon="close" label="Close (compact)" />
      </div>
    </div>
  );
}

function WorstCase() {
  return (
    <div className="cg-block">
      <h3 className="cg-head">Worst case</h3>
      <div className="cg-narrow" data-cg-narrow>
        <Button variant="secondary" fullWidth>
          Datenschutzeinstellungen für alle Arbeitsbereiche übernehmen
        </Button>
        <Button variant="primary">タスクをレビューに移動して担当者に通知する</Button>
        <Button variant="danger" icon="trash">
          Archive 1,284,903 tasks
        </Button>
        <Button variant="ghost">https://github.com/northwind-industries-holdings/platform</Button>
      </div>
    </div>
  );
}

function Fields() {
  const [name, setName] = useState('Aleksandra Wiśniewska-Kowalczyk');
  const [prefix, setPrefix] = useState('');
  const [about, setAbout] = useState('');
  const [role, setRole] = useState('member');
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const formRef = useRef<HTMLFormElement | null>(null);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (prefix.trim() === '') next.prefix = 'A key is 2–8 letters and digits.';
    if (about.trim() === '') next.about = 'Say what this space is for.';
    setErrors(next);
    // After the render that marks them, so the attribute is there to find.
    requestAnimationFrame(() => {
      focusFirstInvalid(formRef.current);
    });
  };

  return (
    <div className="cg-block">
      <h3 className="cg-head">Fields</h3>
      <form className="cg-form" ref={formRef} onSubmit={submit} noValidate data-cg-form>
        <TextInput
          id="cg-name"
          label="Display name"
          value={name}
          onChange={setName}
          maxLength={40}
          help="Shown on cards and in the feed."
          required
        />
        <TextInput
          id="cg-prefix"
          label="Key"
          value={prefix}
          onChange={(v) => {
            setPrefix(v.toUpperCase());
          }}
          appearance="code"
          width="short"
          required
          error={errors.prefix}
        />
        <Textarea
          id="cg-about"
          label="Description"
          value={about}
          onChange={setAbout}
          maxLength={120}
          optional
          error={errors.about}
        />
        <Select
          id="cg-role"
          label="Role"
          value={role}
          onChange={setRole}
          options={[
            { value: 'member', label: 'Member' },
            { value: 'admin', label: 'Admin' },
          ]}
        />
        <TextInput
          id="cg-email"
          label="Email"
          value="bartholomew.fitzgerald@northwind-industries-holdings.example.com"
          onChange={() => undefined}
          readOnly
        />
        <TextInput id="cg-off" label="Locked" value="" onChange={() => undefined} disabled />
        <div className="cg-row">
          <Button type="submit" data-cg="submit">
            Create space
          </Button>
        </div>
      </form>
      <div className="cg-form">
        <TextInput
          id="cg-row-name"
          label="Name"
          help="How this space appears across Laika."
          value="Laika"
          onChange={() => undefined}
          layout="row"
        />
      </div>
    </div>
  );
}

function Icons() {
  return (
    <div className="cg-block">
      <h3 className="cg-head">Icons</h3>
      {ICON_SIZES.map((size) => (
        <div className="cg-row cg-icons" key={size} data-cg-icons={size}>
          {ICON_NAMES.map((name) => (
            <Icon key={name} name={name} size={size} />
          ))}
        </div>
      ))}
      <p className="cg-note">
        <Icon name="alert" label="Warning" /> A labelled icon is an image with a name; every other
        one is hidden from assistive tech.
      </p>
    </div>
  );
}
