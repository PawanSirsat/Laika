import { useShell } from '../shell/shell-context.ts';
import { spaceSettingsHref } from '../../routes/space-settings-url.ts';
import { Icon } from '../icon/Icon.tsx';
import { Tooltip } from '../tooltip/Tooltip.tsx';

/**
 * **Space settings, one press from the space** (LAI-1233 → LAI-1234, the
 * owner): a gear and the words, at the right end of the space's title row.
 *
 * It was a `⋯` holding one item (D-103, LAI-977), which cost a press to find
 * the only thing behind it. A link, so middle-click and copy-link work, and
 * open to every reader of the space: the page itself shows a reader the values
 * and withholds the controls.
 *
 * On a phone the words go and the gear stays (`space.css`), as the LIVE pill
 * keeps its dot: the space's name is worth more of 390px. The words are still
 * the link's name there, and the tooltip says them to a pointer.
 */
export function SpaceSettingsLink({ slug }: { readonly slug: string }) {
  const {
    route: { navigate },
  } = useShell();
  const href = spaceSettingsHref(slug);

  return (
    <Tooltip content="Space settings">
      <a
        href={href}
        className="space-chip space-settings-link"
        data-space-settings
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          navigate(href);
        }}
      >
        <Icon name="gear" size="small" />
        <span className="space-settings-word">Space settings</span>
      </a>
    </Tooltip>
  );
}
