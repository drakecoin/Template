interface Props {
  mini: boolean;
}

export function Header({ mini }: Props) {
  return (
    <header className={mini ? "mini" : ""}>
      <div className="brand">
        <div className="p-badge">P</div>
        <div>
          <h1>Kerbside</h1>
          <small>Find the smartest parking spot in London</small>
        </div>
      </div>
      <div className="yellow-lines" aria-hidden="true" />
    </header>
  );
}
