// A Netflix e a HBO Max só tocam num app com assinatura VMP do Widevine. Ela é feita pela conta gratuita da castLabs
// (EVS), criada uma vez neste computador: veja "App do computador" no versao-php/LEIA-ME.md.
const { execFileSync } = require("child_process");

exports.default = ({ appOutDir }) => execFileSync("python", ["-m", "castlabs_evs.vmp", "sign-pkg", appOutDir], { stdio: "inherit" });
