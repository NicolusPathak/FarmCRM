// components/ui/Avatar.tsx
const COLORS = ['#8B4513','#A0522D','#7B5B3A','#6B3F2A','#5D4037','#795548','#6D4C41','#4E342E'];
const SIZES  = { sm: 32, md: 40, lg: 52 };
const RADIUS = { sm: 8,  md: 10, lg: 14 };
const FONTS  = { sm: 11, md: 13, lg: 17 };

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(n => n[0].toUpperCase()).join('');
}

export default function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const s = SIZES[size];
  return (
    <div style={{
      width: s, height: s, borderRadius: RADIUS[size], flexShrink: 0,
      background: COLORS[name.charCodeAt(0) % COLORS.length],
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontWeight: 700, fontSize: FONTS[size], letterSpacing: '0.02em',
    }}>
      {initials(name)}
    </div>
  );
}
