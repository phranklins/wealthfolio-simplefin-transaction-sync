import { useMemo } from "react";
/**
 * ConfettiBurst component renders a burst of confetti animation.
 * It generates a set of confetti pieces with random properties and animates them outward from the center.
 */

const CONFETTI_COLORS = [
  "#22c55e",
  "#3b82f6",
  "#f59e0b",
  "#ec4899",
  "#8b5cf6",
  "#14b8a6",
  "#f97316",
];

export function ConfettiBurst() {
  const pieces = useMemo(() => {
    const count = 36;
    return Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * 2 * Math.PI + (Math.random() - 0.5) * 0.4;
      const dist = 90 + Math.random() * 130;
      return {
        id: i,
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist - 40,
        rotation: Math.random() * 600 - 300,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        w: Math.random() * 7 + 5,
        h: Math.random() * 5 + 4,
        isCircle: i % 5 === 0,
        delay: Math.random() * 250,
        duration: 700 + Math.random() * 500,
      };
    });
  }, []);

  return (
    <div className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-hidden">
      <style>{`
        @keyframes check-pop {
          0%   { transform: scale(0);    opacity: 0; }
          55%  { transform: scale(1.25); opacity: 1; }
          75%  { transform: scale(0.9);  opacity: 1; }
          100% { transform: scale(1);    opacity: 1; }
        }
        ${pieces
          .map(
            (p) => `
          @keyframes cf-${p.id} {
            0%   { transform: translate(0,0) rotate(0deg); opacity: 1; }
            100% { transform: translate(${p.x}px,${p.y}px) rotate(${p.rotation}deg); opacity: 0; }
          }
        `,
          )
          .join("")}
      `}</style>
      {pieces.map((p) => (
        <div
          key={p.id}
          style={{
            position: "absolute",
            width: p.w,
            height: p.isCircle ? p.w : p.h,
            backgroundColor: p.color,
            borderRadius: p.isCircle ? "50%" : "2px",
            animation: `cf-${p.id} ${p.duration}ms ${p.delay}ms cubic-bezier(0.25,0.46,0.45,0.94) forwards`,
          }}
        />
      ))}
    </div>
  );
}
