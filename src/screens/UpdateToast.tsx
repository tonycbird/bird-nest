/* Updates now install on their own (see registerSW in main.tsx): a broken screen can't tap "Update",
   so waiting for a tap could leave the app stuck on a bad version. Kept as a stub so App stays unchanged. */
export default function UpdateToast() {
  return null;
}
