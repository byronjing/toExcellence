import { useEffect, useRef, useState } from "react";
import type { MdMenu } from "@material/web/menu/menu.js";
import { db, go, type Bank, type Home } from "./api";
import Dashboard from "./Dashboard";
import Admin from "./Admin";
import Practice from "./Practice";
import { Action, IconAction, SymbolIcon, md } from "./material";

const destinations = [
  ["", "首页", "home"],
  ["unit", "单元练习", "edit"],
  ["exam", "抽题模拟", "edit_note"],
  ["wrong", "错题重练", "check_box"],
] as const;
type Entry = { favorite: boolean; tag: string };
type Library = Record<string, Entry>;
function readLibrary(key: string): Library {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "{}");
    return Object.fromEntries(
      Object.entries(raw).filter(
        ([, v]) =>
          v &&
          typeof v === "object" &&
          "favorite" in v &&
          typeof v.favorite === "boolean" &&
          "tag" in v &&
          typeof v.tag === "string",
      ),
    ) as Library;
  } catch {
    return {};
  }
}
function BankCard({
  bank,
  featured,
  entry,
  toggle,
}: {
  bank: Bank;
  featured?: boolean;
  entry?: Entry;
  toggle?: () => void;
}) {
  const count = bank.units.reduce((n, u) => n + u.count, 0);
  return md(
    "md-filled-card",
    { className: "bankCard " + (featured ? "feature" : "subject") },
    <button className="cardOpen" onClick={() => go("unit/" + bank.id)}>
      {md("md-ripple")}
      <span className="cover" aria-hidden="true">
        <i />
        <SymbolIcon name="image" size={54} />
      </span>
      <span className="caption">
        <strong>{featured ? "现已推出" : bank.name}</strong>
        <span>
          {featured
            ? "上新的学科题库 · " + bank.name
            : bank.units.length +
              " 个单元 · " +
              count +
              " 道题" +
              (entry?.tag ? " · " + entry.tag : "")}
        </span>
      </span>
    </button>,
    !featured && (
      <div className="saveBank">
        <IconAction
          icon={entry?.favorite ? "bookmark_added" : "bookmark_add"}
          label={entry?.favorite ? "取消收藏" : "收藏题库"}
          onClick={toggle!}
        />
      </div>
    ),
  );
}
export default function Shell({
  uid,
  home: h,
  route,
  error,
  refresh,
}: {
  uid: string;
  home: Home;
  route: string;
  error: string;
  refresh: () => void;
}) {
  const [page, bankId] = route.split("/"),
    [wide, setWide] = useState(() => innerWidth >= 760),
    [scrolled, setScrolled] = useState(false);
  const key = "toExcellence.library." + uid,
    [library, setLibrary] = useState(() => readLibrary(key)),
    [filter, setFilter] = useState(""),
    [query, search] = useState(""),
    [searching, showSearch] = useState(false),
    [editing, edit] = useState(false),
    [selected, select] = useState(""),
    [tag, setTag] = useState(""),
    [favorite, setFavorite] = useState(false),
    [message, notify] = useState("");
  const menu = useRef<MdMenu>(null),
    content = useRef<HTMLElement>(null);
  useEffect(() => {
    content.current?.scrollTo(0, 0);
    setScrolled(false);
    if (innerWidth < 760) setWide(false);
  }, [route]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => notify(""), 4500);
    return () => clearTimeout(timer);
  }, [message]);
  function save(id: string, entry: Entry) {
    const next = { ...readLibrary(key), [id]: entry };
    try {
      localStorage.setItem(key, JSON.stringify(next));
      setLibrary(next);
      return true;
    } catch {
      notify("浏览器未能保存更改，请检查存储空间。");
      return false;
    }
  }
  function loadBank(id: string) {
    select(id);
    setTag(library[id]?.tag || "");
    setFavorite(!!library[id]?.favorite);
  }
  function openEditor() {
    if (!h.banks.length) {
      notify("还没有可整理的题库");
      return;
    }
    loadBank(h.banks[0].id);
    edit(true);
  }
  const visible = h.banks.filter(
    (b) =>
      (!filter ||
        (filter === "saved" ? library[b.id]?.favorite : !library[b.id]?.tag)) &&
      (b.name + " " + (library[b.id]?.tag || ""))
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const title =
    destinations.find((d) => d[0] === page)?.[1] ??
    ({ admin: "管理后台", random: "随机无限练习", run: "在线作答" }[page] ||
      "首页");
  const menuItem = (label: string, icon: string, fn: () => void) =>
    md(
      "md-menu-item",
      { onClick: fn, key: label },
      <SymbolIcon slot="start" name={icon} />,
      <span slot="headline">{label}</span>,
    );
  return (
    <div className={"studio " + (wide ? "expanded" : "compact")}>
      <aside className="rail">
        <div className="railBrand">
          <SymbolIcon name="layers" size={31} />
          <b>toExcellence</b>
        </div>
        <nav aria-label="学习导航">
          {destinations.map(([dest, name, icon]) => (
            <button
              key={dest}
              aria-current={page === dest ? "page" : undefined}
              onClick={() => go(dest)}
            >
              {md("md-ripple")}
              <SymbolIcon name={icon} />
              <span>{name}</span>
            </button>
          ))}
        </nav>
        <div className="railUser">
          <SymbolIcon name="account_circle" />
          <span>{h.user.name}</span>
        </div>
      </aside>
      <section className="stage">
        <header className={"topbar " + (scrolled ? "raised" : "")}>
          <IconAction
            icon="menu"
            label={wide ? "折叠导航" : "展开导航"}
            onClick={() => setWide(!wide)}
          />
          <h1>{title}</h1>
          <div className="menuAnchor">
            <IconAction
              id="more"
              icon="more_vert"
              label="更多操作"
              onClick={() => menu.current?.show()}
            />
            {md(
              "md-menu",
              {
                ref: menu,
                anchor: "more",
                anchorCorner: "end-end",
                menuCorner: "start-end",
              },
              menuItem("搜索题库", "search", () => {
                go("");
                showSearch(true);
              }),
              menuItem("随机无限练习", "shuffle", () => go("random")),
              h.user.admin &&
                menuItem("管理后台", "settings", () => go("admin")),
              menuItem("退出登录", "logout", async () => {
                const { error } = await db.auth.signOut({ scope: "local" });
                if (error) notify("退出失败，请重试");
              }),
            )}
          </div>
        </header>
        <main
          ref={content}
          className="stageContent"
          onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 0)}
        >
          {error && (
            <div className="notice" role="alert">
              {error} <button onClick={refresh}>重试</button>
            </div>
          )}
          <div
            key={route}
            className={"screen " + (!page ? "libraryScreen" : "detailScreen")}
          >
            {!page ? (
              <>
                <div className="libraryTop">
                  <div className="connected" role="group" aria-label="筛选题库">
                    <Action
                      icon="bookmark"
                      pressed={filter === "saved"}
                      onClick={() =>
                        setFilter(filter === "saved" ? "" : "saved")
                      }
                    >
                      收藏
                    </Action>
                    <Action
                      kind="filled-tonal"
                      icon="label_off"
                      pressed={filter === "untagged"}
                      onClick={() =>
                        setFilter(filter === "untagged" ? "" : "untagged")
                      }
                    >
                      无标签
                    </Action>
                  </div>
                  {searching && (
                    <div className="searchBox">
                      <input
                        autoFocus
                        type="search"
                        aria-label="搜索题库或标签"
                        placeholder="搜索题库或标签"
                        value={query}
                        onChange={(e) => search(e.target.value)}
                      />
                      <IconAction
                        icon="close"
                        label="关闭搜索"
                        onClick={() => {
                          search("");
                          showSearch(false);
                        }}
                      />
                    </div>
                  )}
                </div>
                {visible.length ? (
                  <div className="bankGrid">
                    {!filter && !query && h.banks[0] && (
                      <BankCard bank={h.banks[0]} featured />
                    )}
                    {visible.map((b) => (
                      <BankCard
                        key={b.id}
                        bank={b}
                        entry={library[b.id]}
                        toggle={() =>
                          save(b.id, {
                            favorite: !library[b.id]?.favorite,
                            tag: library[b.id]?.tag || "",
                          })
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <div className="empty">
                    <SymbolIcon name="bookmarks" size={44} />
                    <h2>
                      {!h.banks.length
                        ? "暂无已发布题库"
                        : filter === "saved"
                          ? "暂无匹配的收藏"
                          : "没有匹配的题库"}
                    </h2>
                    {(filter || query) && (
                      <Action
                        kind="text"
                        onClick={() => {
                          setFilter("");
                          search("");
                        }}
                      >
                        查看全部题库
                      </Action>
                    )}
                  </div>
                )}
              </>
            ) : page === "admin" && h.user.admin ? (
              <Admin home={h} refresh={refresh} />
            ) : page === "run" ? (
              <Practice key={bankId} uid={uid} id={bankId} />
            ) : (
              <Dashboard
                home={h}
                initialMode={
                  ["unit", "random", "exam", "wrong"].includes(page)
                    ? page
                    : "unit"
                }
                initialBank={bankId}
              />
            )}
          </div>
        </main>
      </section>
      {!page &&
        md(
          "md-fab",
          {
            className: "editFab",
            variant: "primary",
            "aria-label": "整理题库收藏和标签",
            title: "整理题库收藏和标签",
            onClick: openEditor,
          },
          <SymbolIcon slot="icon" name="edit" />,
        )}
      {editing &&
        md(
          "md-dialog",
          { open: true, onclosed: () => edit(false) },
          <span slot="headline">整理题库</span>,
          <div slot="content" className="editor">
            <label>
              题库
              <select
                value={selected}
                onChange={(e) => loadBank(e.target.value)}
              >
                {h.banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              个人标签
              <input
                value={tag}
                maxLength={32}
                placeholder="无标签"
                onChange={(e) => setTag(e.target.value)}
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={favorite}
                onChange={(e) => setFavorite(e.target.checked)}
              />
              收藏此题库
            </label>
          </div>,
          <div slot="actions">
            <Action kind="text" onClick={() => edit(false)}>
              取消
            </Action>
            <Action
              onClick={() => {
                if (save(selected, { favorite, tag: tag.trim() })) {
                  edit(false);
                  notify("已保存");
                }
              }}
            >
              保存
            </Action>
          </div>,
        )}
      {message && (
        <div className="snack" role="status">
          {message}
        </div>
      )}
    </div>
  );
}
