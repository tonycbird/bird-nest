export default function Later(props: { icon: string; title: string; phase: number }) {
  return (
    <div className="empty">
      <div className="big">{props.icon}</div>
      <h2>{props.title}</h2>
      <p>Phase {props.phase}</p>
    </div>
  );
}
