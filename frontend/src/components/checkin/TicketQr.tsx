"use client";

/**
 * A ticket's QR code: black on white with a quiet zone around it, whatever
 * the theme, so the scanner at the door reads it first time. It scales down
 * with its container and never grows past `size`.
 */

import { QRCodeSVG } from "qrcode.react";

export function TicketQr({ value, label, size = 160, className }: { value: string; label: string; size?: number; className?: string }) {
  return (
    <div className={className} style={{ background: "#FFFFFF", borderRadius: 12, lineHeight: 0, maxWidth: size }}>
      <QRCodeSVG
        value={value}
        size={size}
        level="M"
        marginSize={4}
        bgColor="#FFFFFF"
        fgColor="#000000"
        title={label}
        role="img"
        aria-label={label}
        style={{ display: "block", width: "100%", height: "auto" }}
      />
    </div>
  );
}
