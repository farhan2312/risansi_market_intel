// DEBTOR (sheet) code → users.id, for the monthly outstanding upload.
//
// This lives here rather than beside the action that uses it, and the reason is
// not tidiness. app/actions/risansi-outstanding.ts carries 'use server', and a
// 'use server' module may export nothing but async functions. Exporting this
// object from there compiled cleanly, passed every local check, and then threw
//
//   A "use server" file can only export async functions, found object.
//
// on the first real click — before any application code ran, which is why the
// upload failed with nothing to show for it and why no amount of error handling
// inside the action could surface a reason. Keeping the constant out of that
// file is what stops it happening again.
//
// AV / MRK / SV are personal initials (confident); NI / SI / VA are territory or
// ambiguous codes mapped on best judgment — still worth a sanity check with the
// team. The raw sheet code is stored on the client row too, so nothing is lost
// if a mapping turns out to be wrong.
export const DEBTOR_USER: Record<string, number> = {
  AV:  5,   // Anil Vankudre
  MRK: 6,   // Madhav R Kulkarni
  SV:  9,   // Sudhir Vichare
  NI:  4,   // Amit Srivastava (North India)
  SI:  10,  // Guna Sekaran (South India)
  VA:  20,  // Vishal Gaikwad (best guess)
};
