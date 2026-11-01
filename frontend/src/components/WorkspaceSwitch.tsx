"use client";

/**
 * "Switch workspace": back to the picker at /workspaces.
 *
 * Shown only to people with more than one place to work (two events, an
 * organisation and an event, …); for everyone else the link would lead to a
 * page with a single card on it. The count comes from the same endpoint the
 * picker reads, once per page load of the shell.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeftRight } from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";
import { entriesFrom, fetchWorkspaces } from "@/lib/workspaces";

export function useHasOtherWorkspaces(): boolean {
  const [many, setMany] = useState(false);
  useEffect(() => {
    let alive = true;
    fetchWorkspaces()
      .then((ws) => {
        if (alive) setMany(entriesFrom(ws).length > 1);
      })
      .catch(() => {
        /* no picker link then; nothing else depends on it */
      });
    return () => {
      alive = false;
    };
  }, []);
  return many;
}

export function WorkspaceSwitchLink({
  className,
  onClick,
  iconSize = 14,
}: {
  className: string;
  onClick?: () => void;
  iconSize?: number;
}) {
  const { t } = useTranslation();
  const many = useHasOtherWorkspaces();
  if (!many) return null;
  return (
    <Link href="/workspaces" onClick={onClick} className={className} title={t("workspaces.switch")}>
      <ArrowLeftRight size={iconSize} />
      {t("workspaces.switch")}
    </Link>
  );
}
