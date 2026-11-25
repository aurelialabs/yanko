import type { CSSProperties } from "react";

const sparks = [
  [14, 30, 0],
  [76, 16, 0.8],
  [86, 62, 1.4],
  [30, 84, 0.5],
  [9, 65, 1.7],
  [58, 7, 1.1],
  [65, 88, 0.2],
  [93, 35, 2],
];

export function FairyLight() {
  return (
    <div className="fairy-light" aria-hidden="true">
      <div className="fairy-halo" />
      <div className="fairy-orbit" />
      <div className="fairy-core">
        <span>✦</span>
      </div>
      {sparks.map(([x, y, delay], index) => (
        <span
          className="fairy-spark"
          key={index}
          style={
            {
              "--spark-x": `${x}%`,
              "--spark-y": `${y}%`,
              "--spark-delay": `${delay}s`,
            } as CSSProperties
          }
        >
          ✧
        </span>
      ))}
    </div>
  );
}
