import { useState } from "react";

// Flat, original dish illustrations. Chosen from keywords in the dish name / category, so no restaurant data lives here.
const KINDS = [
  ["drink", /chai|tea|coffee|lime|soda|juice|lassi|shake|drink|water|cola|mojito|sharbat|milk/i],
  ["dessert", /meetha|dessert|sweet|ice ?cream|kheer|gulab|halwa|cake|pudding|brownie|kulfi|jalebi|rabdi/i],
  ["biscuit", /biscuit|cookie|bakery|bread ?stick|rusk|puff|bun|pastry|samosa/i],
  ["bread", /naan|roti|paratha|kulcha|bread|chapati|bhatura|phulka|puri/i],
  ["rice", /biryani|biriyani|pulao|rice|khichdi|fried rice|haleem/i],
  ["skewer", /tikka|kebab|kabab|65|tandoori|starter|fry|grill|manchurian|pakora|fingers|wings|lollipop|tangdi/i],
  ["bowl", /curry|masala|gravy|dal|daal|butter|korma|paneer|main|soup|sambar|kadai|chettinad|salan|mirchi/i],
  ["noodles", /noodle|pasta|chowmein|hakka|maggi/i],
  ["burger", /burger|sandwich|pizza|wrap|roll|shawarma|frankie|sub/i],
];

export function kindOf(name = "", category = "") {
  const hay = `${name} ${category}`;
  for (const [k, re] of KINDS) if (re.test(name)) return k;
  for (const [k, re] of KINDS) if (re.test(hay)) return k;
  return "plate";
}

const hashOf = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const BG = ["bg-accent-soft", "bg-brand-soft"];

const C = { rice: "#F2D58A", rice2: "#E7BE5C", red: "#C9442B", dark: "#7A3B1E", green: "#4C9A55", cream: "#FFF7E6", plate: "#FFFFFF", plateEdge: "#DDD6C8", gold: "#D9962B", brown: "#8B5A2B", tea: "#C77B3A", leaf: "#3F8F4F" };

function Shapes({ kind }) {
  switch (kind) {
    case "rice":
      return (
        <g>
          <path d="M12 52h56a28 20 0 0 1-56 0Z" fill={C.dark} />
          <path d="M16 50c2-16 14-26 24-26s22 10 24 26Z" fill={C.rice} />
          {[[28, 40], [36, 34], [46, 38], [52, 44], [32, 46], [42, 44], [24, 46]].map(([x, y], i) => <ellipse key={i} cx={x} cy={y} rx="3.4" ry="1.5" fill={C.rice2} transform={`rotate(${i * 25} ${x} ${y})`} />)}
          <circle cx="40" cy="30" r="5" fill={C.red} /><circle cx="48" cy="34" r="3.5" fill={C.green} />
          <path d="M30 18c-3-4 3-6 0-10M42 16c-3-4 3-6 0-10M54 18c-3-4 3-6 0-10" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" fill="none" opacity=".85" />
        </g>
      );
    case "bowl":
      return (
        <g>
          <path d="M10 36h60a30 24 0 0 1-60 0Z" fill={C.dark} />
          <ellipse cx="40" cy="36" rx="30" ry="7" fill={C.red} />
          <ellipse cx="40" cy="35" rx="22" ry="4.5" fill="#E2674A" />
          <circle cx="32" cy="34" r="3" fill={C.cream} /><circle cx="46" cy="36" r="2.5" fill={C.cream} />
          <path d="M36 32c4-5 9-4 10 0" stroke={C.green} strokeWidth="2.4" fill="none" strokeLinecap="round" />
          <path d="M28 22c-3-4 3-6 0-10M42 20c-3-4 3-6 0-10M54 22c-3-4 3-6 0-10" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" fill="none" opacity=".85" />
        </g>
      );
    case "skewer":
      return (
        <g>
          <path d="M8 62 70 12" stroke={C.brown} strokeWidth="3" strokeLinecap="round" />
          {[[24, 50], [34, 42], [44, 34], [54, 26]].map(([x, y], i) => <rect key={i} x={x - 8} y={y - 7} width="16" height="14" rx="5" fill={i % 2 ? C.red : C.gold} transform={`rotate(-38 ${x} ${y})`} />)}
          <circle cx="22" cy="24" r="6" fill={C.green} opacity=".9" /><circle cx="60" cy="56" r="6" fill={C.green} opacity=".9" />
        </g>
      );
    case "bread":
      return (
        <g>
          <path d="M40 14c18 0 28 14 26 30-2 14-14 22-26 22S16 58 14 44c-2-16 8-30 26-30Z" fill="#EBC27E" />
          <path d="M40 22c12 0 20 10 18 22-2 10-10 16-18 16s-16-6-18-16c-2-12 6-22 18-22Z" fill="#F4D7A0" />
          {[[30, 34], [44, 30], [50, 44], [34, 50], [42, 42]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="3" fill="#C99347" />)}
          <path d="M26 44c4-3 8-3 12 0" stroke="#fff" strokeWidth="2" opacity=".6" fill="none" strokeLinecap="round" />
        </g>
      );
    case "drink":
      return (
        <g>
          <path d="M22 28h30v22a12 12 0 0 1-12 12h-6a12 12 0 0 1-12-12Z" fill={C.tea} />
          <path d="M22 28h30v8H22Z" fill="#E7A55E" />
          <path d="M52 34h6a7 7 0 0 1 0 14h-6" stroke={C.tea} strokeWidth="4" fill="none" />
          <ellipse cx="37" cy="28" rx="15" ry="3.2" fill="#F5E2C2" />
          <path d="M30 20c-3-4 3-6 0-10M42 20c-3-4 3-6 0-10" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" fill="none" opacity=".85" />
          <ellipse cx="38" cy="66" rx="22" ry="3" fill="#000" opacity=".08" />
        </g>
      );
    case "dessert":
      return (
        <g>
          <path d="M16 40h48a24 18 0 0 1-48 0Z" fill="#B4573B" />
          <circle cx="40" cy="34" r="14" fill="#F7E3C0" /><circle cx="40" cy="26" r="9" fill="#F3B3C0" />
          <circle cx="40" cy="15" r="3.6" fill={C.red} />
          <circle cx="32" cy="32" r="2" fill={C.gold} /><circle cx="48" cy="34" r="2" fill={C.gold} />
          <rect x="30" y="58" width="20" height="4" rx="2" fill="#B4573B" opacity=".6" />
        </g>
      );
    case "biscuit":
      return (
        <g>
          {[[28, 34, 0], [50, 30, 20], [40, 52, -12]].map(([x, y, r], i) => (
            <g key={i} transform={`rotate(${r} ${x} ${y})`}>
              <circle cx={x} cy={y} r="14" fill="#E2B069" /><circle cx={x} cy={y} r="10.5" fill="#EBC285" />
              {[[-4, -3], [4, -1], [-1, 5], [5, 5]].map(([dx, dy], j) => <circle key={j} cx={x + dx} cy={y + dy} r="1.4" fill="#A9742E" />)}
            </g>
          ))}
        </g>
      );
    case "noodles":
      return (
        <g>
          <path d="M12 38h56a28 22 0 0 1-56 0Z" fill={C.dark} />
          <path d="M16 38c4-14 14-18 24-18s20 4 24 18Z" fill="#F2C86B" />
          {[0, 1, 2, 3, 4].map((i) => <path key={i} d={`M${20 + i * 8} 36c2-8 8-10 12-4s8 2 10-4`} stroke="#E0A93C" strokeWidth="2.2" fill="none" strokeLinecap="round" />)}
          <circle cx="44" cy="26" r="4" fill={C.red} /><circle cx="32" cy="28" r="3" fill={C.green} />
        </g>
      );
    case "burger":
      return (
        <g>
          <path d="M14 34c0-14 12-20 26-20s26 6 26 20Z" fill="#E1A04B" />
          <rect x="12" y="35" width="56" height="6" rx="3" fill={C.green} />
          <rect x="14" y="41" width="52" height="8" rx="4" fill={C.dark} />
          <rect x="12" y="49" width="56" height="5" rx="2.5" fill="#F3C857" />
          <path d="M14 54h52c0 8-8 12-26 12S14 62 14 54Z" fill="#E1A04B" />
          {[[28, 24], [38, 20], [48, 24], [58, 28]].map(([x, y], i) => <ellipse key={i} cx={x} cy={y} rx="2" ry="1.2" fill="#FFF3D6" />)}
        </g>
      );
    default:
      return (
        <g>
          <ellipse cx="40" cy="48" rx="30" ry="11" fill={C.plate} stroke={C.plateEdge} strokeWidth="2" />
          <ellipse cx="40" cy="47" rx="19" ry="6.5" fill="#F4EFE4" />
          <path d="M18 44c0-16 10-24 22-24s22 8 22 24Z" fill="#D5D0C6" />
          <circle cx="40" cy="17" r="4" fill="#D5D0C6" /><rect x="39" y="14" width="2" height="4" fill="#B9B3A7" />
        </g>
      );
  }
}

export function DishArt({ name, category, className = "" }) {
  const kind = kindOf(name, category);
  const bg = BG[hashOf(`${name}${category}`) % BG.length];
  return (
    <div className={`${bg} flex items-center justify-center overflow-hidden ${className}`} aria-hidden="true">
      <svg viewBox="0 0 80 72" className="h-[88%] w-[88%]" role="presentation">
        <Shapes kind={kind} />
      </svg>
    </div>
  );
}

/** Photo with graceful fallback to the illustration. */
export function DishImage({ item, className = "" }) {
  const [broken, setBroken] = useState(false);
  if (item.image_url && !broken) {
    return <img src={item.image_url} alt={item.name} loading="lazy" onError={() => setBroken(true)} className={`object-cover ${className}`} />;
  }
  return <DishArt name={item.name} category={item.category} className={className} />;
}
