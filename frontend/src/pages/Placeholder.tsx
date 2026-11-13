export default function Placeholder({ title, milestone }: { title: string; milestone?: string }) {
  return (
    <>
      <header className="page-header">
        <h1>{title}</h1>
      </header>
      <div className="empty">
        <h3>Not built yet</h3>
        <p>{milestone ? `This screen is planned for milestone ${milestone}.` : "This page does not exist."}</p>
      </div>
    </>
  );
}
