type Props = {
  lat: number;
  lng: number;
  name: string;
};

export function LandmarkMap({ lat, lng, name }: Props) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;

  const span = 0.006;
  const bbox = [lng - span, lat - span / 2, lng + span, lat + span / 2].join("%2C");
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lng}`;

  return (
    <div className="mt-5 overflow-hidden rounded-2xl border border-border">
      <iframe
        title={`Map showing ${name}`}
        src={src}
        loading="lazy"
        className="h-56 w-full border-0 sm:h-64"
      />
      <a
        href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`}
        target="_blank"
        rel="noreferrer"
        className="block bg-muted px-4 py-2 text-xs text-muted-foreground"
      >
        Open larger map
      </a>
    </div>
  );
}
