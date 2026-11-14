import { createElement, type ReactNode } from "react";
import "@material/web/textfield/outlined-text-field.js";
import "@material/web/button/filled-button.js";
import "@material/web/button/filled-tonal-button.js";
import "@material/web/button/text-button.js";
import "@material/web/iconbutton/icon-button.js";
import "@material/web/fab/fab.js";
import "@material/web/ripple/ripple.js";
import "@material/web/dialog/dialog.js";
import "@material/web/menu/menu.js";
import "@material/web/menu/menu-item.js";
import "@material/web/icon/icon.js";
import "@material/web/labs/card/filled-card.js";
export const md = createElement;
export function SymbolIcon({
  name,
  size = 24,
  slot,
  className = "",
}: {
  name: string;
  size?: number;
  slot?: string;
  className?: string;
}) {
  return md(
    "md-icon",
    {
      slot,
      className,
      style: { fontSize: size, "--md-icon-size": size + "px" },
      "aria-hidden": true,
    },
    name,
  );
}
function symbol(name: string) {
  return (p: { size?: number; className?: string }) => (
    <SymbolIcon name={name} {...p} />
  );
}
export const BookOpen = symbol("menu_book"),
  Check = symbol("check"),
  CheckCheck = symbol("done_all"),
  Clock3 = symbol("schedule"),
  Layers3 = symbol("layers"),
  LockKeyhole = symbol("lock"),
  NotebookPen = symbol("edit_note"),
  Shuffle = symbol("shuffle"),
  Sparkles = symbol("auto_awesome"),
  ChevronRight = symbol("chevron_right");
export function IconAction({
  icon,
  label,
  onClick,
  id,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  id?: string;
}) {
  return md(
    "md-icon-button",
    { id, "aria-label": label, title: label, onClick },
    <SymbolIcon name={icon} />,
  );
}
export function Action({
  children,
  kind = "filled",
  onClick,
  icon,
  pressed,
}: {
  children: ReactNode;
  kind?: "filled" | "filled-tonal" | "text";
  onClick: () => void;
  icon?: string;
  pressed?: boolean;
}) {
  return md(
    "md-" + kind + "-button",
    { onClick, "aria-pressed": pressed, className: pressed ? "pressed" : "" },
    icon && <SymbolIcon slot="icon" name={icon} size={20} />,
    children,
  );
}
