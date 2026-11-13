/**
 * The sign-in page the desktop serves on loopback. It signs the member in with RAD's Firebase project, the corporate
 * Google sign-in RAD itself uses, and hands the Google ID token to the desktop, which exchanges it with RAD. Firebase
 * accepts `localhost` as an authorized domain, so the page is served there. RAD's own pages are in Spanish, and so is
 * this one, like the web gateway's sign-in page.
 */
export function loginPage(input: { firebase: unknown; state: string }) {
  const values = JSON.stringify(input).replace(/</g, "\\u003c")

  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BambuTechCode · RAD</title><style>body{margin:0;background:#102b22;color:#edf7ee;font-family:inherit;min-height:100vh;display:grid;place-items:center}main{max-width:520px;margin:30px;padding:40px;border:1px solid #557a62;border-radius:20px;background:#18382b}small{letter-spacing:.15em;color:#b0d98c}h1{font-size:34px;line-height:1.2}p{line-height:1.7;color:#c1d7cb}button{padding:14px 22px;border:0;border-radius:8px;background:#b3e58d;color:#18382b;font:inherit;cursor:pointer}button[hidden]{display:none}#status{min-height:24px}</style><main><small>BAMBU TECHSERVICES</small><h1>Inicia sesión en BambuTechCode.</h1><p>Usa tu cuenta corporativa de Google. Tus conversaciones, sesiones y uso de MCP estarán disponibles en Gobernanza de RAD según tus permisos.</p><button id="login">Continuar con Google</button><p id="status" role="status"></p></main><script type="module">
  import{initializeApp}from"https://www.gstatic.com/firebasejs/10.11.1/firebase-app.js";
  import{getAuth,GoogleAuthProvider,signInWithPopup,signOut}from"https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js";
  const input=${values},auth=getAuth(initializeApp(input.firebase)),button=document.getElementById('login'),status=document.getElementById('status');
  button.onclick=async()=>{button.disabled=true;status.textContent='Continúa en la ventana de Google.';try{const provider=new GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});const idToken=await(await signInWithPopup(auth,provider)).user.getIdToken();await signOut(auth);const response=await fetch('/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:input.state,idToken})});if(response.status===403){status.textContent='Tu cuenta de Google no está registrada en RAD. Usa tu cuenta corporativa.';button.disabled=false;return}if(!response.ok)throw Error();button.hidden=true;status.textContent='Listo. Regresa a BambuTechCode; ya puedes cerrar esta pestaña.'}catch(error){status.textContent=error?.code==='auth/popup-blocked'?'Permite las ventanas emergentes para iniciar sesión.':'No se pudo iniciar sesión. Intenta nuevamente.';button.disabled=false}};
  </script></html>`
}
