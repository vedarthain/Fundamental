"use client";

import { useEffect, useRef, useState } from "react";
import {
  ExternalLink,
  Headphones,
  Loader2,
  RotateCcw,
  RotateCw,
  Video,
  X,
} from "lucide-react";

export type ActiveConcallAudio = {
  announcementId: string;
  symbol: string;
  companyName: string;
  quarterLabel?: string | null;
  preResolvedUrl?: string | null;
  preResolvedKind?: "audio" | "video" | "youtube" | "webcast" | null;
};

type ResolvedPayload = {
  ok: boolean;
  mediaUrl?: string;
  mediaKind?: "audio" | "video" | "youtube" | "webcast";
  youtubeEmbedUrl?: string | null;
  sourcePdfUrl?: string | null;
  error?: string;
};

const SPEEDS = [1, 1.25, 1.5, 1.75, 2] as const;

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "company portal";
  }
}

export function ConcallAudioBar({
  target,
  onClose,
}: {
  target: ActiveConcallAudio | null;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [resolved, setResolved] = useState<ResolvedPayload | null>(null);
  const [speed, setSpeed] = useState<number>(1);
  const [mediaError, setMediaError] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!target) {
      setResolved(null);
      setMediaError(false);
      return;
    }

    setMediaError(false);

    if (target.preResolvedUrl && target.preResolvedKind) {
      const ytMatch = target.preResolvedUrl.match(
        /(?:youtube\.com\/(?:watch\?v=|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i,
      );
      setResolved({
        ok: true,
        mediaUrl: target.preResolvedUrl,
        mediaKind: target.preResolvedKind,
        youtubeEmbedUrl: ytMatch
          ? `https://www.youtube.com/embed/${ytMatch[1]}?autoplay=1&rel=0`
          : null,
      });
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setResolved(null);

    fetch(`/api/concall/audio?id=${encodeURIComponent(target.announcementId)}`)
      .then((r) => r.json())
      .then((data: ResolvedPayload) => {
        if (!cancelled) {
          setResolved(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResolved({ ok: false, error: "Unable to resolve audio link right now." });
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [target]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, [speed, resolved]);

  if (!target) return null;

  const seekBy = (deltaSec: number) => {
    const el = audioRef.current || videoRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, (el.currentTime || 0) + deltaSec);
  };

  const kind = resolved?.mediaKind;
  const mediaUrl = resolved?.mediaUrl;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-1.5rem)] max-w-[880px] rounded-2xl border border-slate-800 bg-slate-950 text-white shadow-2xl px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-400/30 flex items-center justify-center shrink-0">
            {kind === "video" || kind === "youtube" ? (
              <Video size={16} className="text-amber-400" />
            ) : (
              <Headphones size={16} className="text-amber-400" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-[13.5px] truncate">
                {target.companyName}
              </span>
              <span className="px-1.5 py-0.5 rounded bg-slate-800 font-mono text-[10.5px] text-slate-300">
                {target.symbol}
              </span>
              {target.quarterLabel && (
                <span className="px-1.5 py-0.5 rounded bg-indigo-500/30 border border-indigo-400/30 font-mono text-[10.5px] text-indigo-200">
                  {target.quarterLabel}
                </span>
              )}
            </div>
            <div className="text-[11px] text-slate-400 truncate">
              {loading
                ? "Extracting company audio stream from exchange filing…"
                : mediaUrl
                  ? `Source: ${hostLabel(mediaUrl)}`
                  : resolved?.error ?? "Audio stream"}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {(kind === "audio" || kind === "video") && !mediaError && (
            <>
              <button
                type="button"
                onClick={() => seekBy(-15)}
                title="Rewind 15s"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-[11px] font-mono text-slate-200"
              >
                <RotateCcw size={12} /> 15s
              </button>
              <button
                type="button"
                onClick={() => seekBy(15)}
                title="Forward 15s"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-[11px] font-mono text-slate-200"
              >
                15s <RotateCw size={12} />
              </button>
              <div className="inline-flex items-center rounded-md bg-slate-900 border border-slate-800 p-0.5">
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSpeed(s)}
                    className={`px-1.5 py-0.5 rounded text-[11px] font-mono transition-colors ${
                      speed === s
                        ? "bg-amber-500 text-slate-950 font-bold"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            </>
          )}

          {mediaUrl && (
            <a
              href={mediaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-[11.5px] font-medium text-slate-200"
            >
              Direct Link <ExternalLink size={11} />
            </a>
          )}

          <button
            type="button"
            onClick={onClose}
            aria-label="Close audio player"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Body: Loader / Inline Audio / Inline Video / YouTube / Webcast Portal */}
      <div className="mt-2.5">
        {loading && (
          <div className="flex items-center gap-2 py-2 text-[12.5px] text-slate-300">
            <Loader2 size={15} className="animate-spin text-amber-400" />
            Resolving direct recording URL…
          </div>
        )}

        {!loading && resolved?.ok && kind === "audio" && mediaUrl && !mediaError && (
          <audio
            ref={audioRef}
            src={mediaUrl}
            controls
            autoPlay
            onLoadedMetadata={(e) => {
              e.currentTarget.playbackRate = speed;
            }}
            onError={() => setMediaError(true)}
            className="w-full h-9 rounded-lg"
          />
        )}

        {!loading && resolved?.ok && kind === "video" && mediaUrl && !mediaError && (
          <video
            ref={videoRef}
            src={mediaUrl}
            controls
            autoPlay
            onLoadedMetadata={(e) => {
              e.currentTarget.playbackRate = speed;
            }}
            onError={() => setMediaError(true)}
            className="w-full max-h-[240px] rounded-xl bg-black"
          />
        )}

        {!loading && resolved?.ok && kind === "youtube" && resolved.youtubeEmbedUrl && (
          <div className="rounded-xl overflow-hidden bg-black aspect-video max-h-[280px] mx-auto">
            <iframe
              src={resolved.youtubeEmbedUrl}
              title={`${target.companyName} Earnings Call`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="w-full h-full border-0"
            />
          </div>
        )}

        {!loading &&
          resolved?.ok &&
          mediaUrl &&
          (kind === "webcast" || mediaError) && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 rounded-xl bg-slate-900 border border-slate-800 px-3.5 py-2.5">
              <div className="text-[12.5px] text-slate-300">
                {mediaError
                  ? `Direct browser streaming is restricted by ${hostLabel(mediaUrl)} CORS headers — open the recording directly:`
                  : `${target.companyName} hosts this concall audio inside their investor webcast player on ${hostLabel(mediaUrl)}:`}
              </div>
              <a
                href={mediaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-[12.5px] font-bold shrink-0 transition-colors"
              >
                <Headphones size={14} />
                Launch Audio on {hostLabel(mediaUrl)} <ExternalLink size={12} />
              </a>
            </div>
          )}

        {!loading && !resolved?.ok && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-900 border border-slate-800 px-3.5 py-2 text-[12px] text-slate-300">
            <span>{resolved?.error || "Could not extract an external audio stream."}</span>
            {resolved?.sourcePdfUrl && (
              <a
                href={resolved.sourcePdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-amber-400 hover:underline font-medium"
              >
                Inspect Exchange Notice <ExternalLink size={11} />
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
