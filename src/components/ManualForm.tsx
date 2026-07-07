import { useState } from "react";
import { FolderOpen, Loader2, Save, X } from "lucide-react";
import type { ManualGamePayload } from "../types";
import { Drawer } from "@/components/ui/Drawer";
import { pickExecutable } from "../tauri";
import { readError } from "../utils/format";

/** "shadow_of_the_erdtree-1.exe" -> "Shadow Of The Erdtree 1", best-effort until the user edits it. */
function titleFromFilename(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  const withoutExt = base.replace(/\.exe$/i, "");
  const spaced = withoutExt.replace(/[_-]+/g, " ").trim();
  return spaced.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function directoryOf(path: string): string {
  const index = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return index > 0 ? path.slice(0, index) : path;
}

export function ManualForm({
  draft,
  busy,
  reduceMotion = false,
  onChange,
  onSave,
  onCancel,
}: {
  draft: ManualGamePayload;
  busy: boolean;
  reduceMotion?: boolean;
  onChange: (draft: ManualGamePayload) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const isEditing = !!draft.id;
  const [browsing, setBrowsing] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [touched, setTouched] = useState<{ title?: boolean; launchTarget?: boolean }>({});

  const titleError = !draft.title.trim() ? "Enter a title." : null;
  const target = draft.launchTarget.trim();
  const isUrl = /^https?:\/\//i.test(target);
  const launchTargetError = !target
    ? "Choose an executable to launch, or type its full path."
    : !isUrl && !/^[a-zA-Z]:[\\/]/.test(target)
      ? "Enter a full path (e.g. C:\\Games\\MyGame\\game.exe)."
      : null;
  // A path that exists but isn't an .exe can still be launchable (shortcuts, scripts) - warn, don't block.
  const launchTargetWarning =
    target && !launchTargetError && !isUrl && !/\.exe$/i.test(target)
      ? "This path doesn't end in .exe — double-check it's something Windows can launch."
      : null;
  const valid = !titleError && !launchTargetError;

  const showTitleError = touched.title ? titleError : null;
  const showLaunchTargetError = touched.launchTarget ? launchTargetError : null;

  async function browseForExecutable() {
    setBrowsing(true);
    setBrowseError(null);
    try {
      const picked = await pickExecutable();
      if (!picked) return;
      onChange({
        ...draft,
        title: draft.title.trim() || titleFromFilename(picked),
        launchTarget: picked,
        installPath: directoryOf(picked),
      });
    } catch (err) {
      setBrowseError(readError(err));
    } finally {
      setBrowsing(false);
    }
  }

  return (
    <Drawer
      drawerKey="manual-form"
      title={isEditing ? "Edit Game" : "Add Game"}
      onClose={onCancel}
      reduceMotion={reduceMotion}
      width="480px"
    >
      <div className="form-panel">
        <label>
          Title
          <input
            value={draft.title}
            aria-invalid={showTitleError ? true : undefined}
            aria-describedby={showTitleError ? "manual-title-error" : undefined}
            onChange={(event) => onChange({ ...draft, title: event.target.value })}
            onBlur={() => setTouched((prev) => ({ ...prev, title: true }))}
          />
          {showTitleError && <p id="manual-title-error" className="hint hint-error">{showTitleError}</p>}
        </label>
        <label>
          Executable path
          <div className="input-with-action">
            <input
              value={draft.launchTarget}
              aria-invalid={showLaunchTargetError ? true : undefined}
              aria-describedby={showLaunchTargetError ? "manual-target-error" : undefined}
              onChange={(event) => onChange({ ...draft, launchTarget: event.target.value, installPath: event.target.value })}
              onBlur={() => setTouched((prev) => ({ ...prev, launchTarget: true }))}
            />
            <button type="button" onClick={browseForExecutable} title="Browse for .exe" disabled={browsing}>
              {browsing ? <Loader2 size={18} className="spin" /> : <FolderOpen size={18} />} Browse
            </button>
          </div>
          {showLaunchTargetError && <p id="manual-target-error" className="hint hint-error">{showLaunchTargetError}</p>}
          {!showLaunchTargetError && launchTargetWarning && <p className="hint">{launchTargetWarning}</p>}
          {browseError && <p className="hint hint-error">{browseError}</p>}
        </label>
        {!isEditing ? (
          <p className="hint">Cover art is fetched automatically from SteamGridDB using the title above once you save.</p>
        ) : null}
        {isEditing ? (
          <>
            <label>
              Launch arguments
              <input value={draft.launchArgs ?? ""} onChange={(event) => onChange({ ...draft, launchArgs: event.target.value })} />
            </label>
            <label>
              Hero image path or URL
              <input value={draft.heroImage ?? ""} onChange={(event) => onChange({ ...draft, heroImage: event.target.value })} />
            </label>
            <label>
              Cover image path or URL
              <input value={draft.coverImage ?? ""} onChange={(event) => onChange({ ...draft, coverImage: event.target.value })} />
            </label>
            <label>
              Description
              <textarea
                rows={4}
                value={draft.description ?? ""}
                onChange={(event) => onChange({ ...draft, description: event.target.value })}
              />
            </label>
          </>
        ) : null}
        <div className="actions">
          <button
            className="primary"
            onClick={() => {
              if (!valid) {
                setTouched({ title: true, launchTarget: true });
                return;
              }
              onSave();
            }}
            disabled={busy}
            aria-disabled={!valid || busy}
          >
            {busy ? <Loader2 size={18} className="spin" /> : <Save size={18} />} {busy ? "Saving..." : "Save"}
          </button>
          <button onClick={onCancel}><X size={18} /> Cancel</button>
        </div>
      </div>
    </Drawer>
  );
}
