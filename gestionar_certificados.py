"""
Genera (o renueva) el certificado HTTPS que usa scanner_bridge.py, de forma
que cualquier PC de la oficina listada en ips_permitidas.txt pueda usarlo
SIN que cada navegador tenga que aceptar una advertencia de seguridad.

Cómo funciona:
  1. La primera vez, crea una autoridad certificadora (CA) propia
     (ca_cert.pem / ca_key.pem). Esto se hace UNA sola vez, para siempre.
  2. Genera un certificado (bridge_cert.pem / bridge_key.pem) firmado por
     esa CA, válido para TODAS las IPs listadas en ips_permitidas.txt.
  3. Ese mismo par bridge_cert.pem/bridge_key.pem se copia junto con
     scanner_bridge.py a cualquier PC que vaya a correr el bridge — sirve
     para todas las IPs de la lista, no hace falta un certificado distinto
     por PC.

Para que un navegador deje de mostrar advertencias, esa PC (una sola vez,
para siempre, sin importar cuántas veces se mueva el escáner después) tiene
que confiar en la CA — correr confiar_ca_windows.bat como administrador.

Uso:
  1. Editar ips_permitidas.txt: una IP de PC por línea (agregar todas las
     que puedan llegar a tener el escáner conectado alguna vez).
  2. Correr:  .venv_bridge\\Scripts\\python gestionar_certificados.py
  3. Copiar bridge_cert.pem, bridge_key.pem y confiar_ca_windows.bat a cada
     PC de la oficina (junto con scanner_bridge.py).
  4. En cada PC, correr confiar_ca_windows.bat como administrador (una sola
     vez por PC, para siempre).

Si más adelante se agrega una PC nueva: agregar su IP a
ips_permitidas.txt, volver a correr este script, y volver a copiar
bridge_cert.pem/bridge_key.pem (el mismo par, ya actualizado) a todas las
PCs que corren el bridge. NO hace falta volver a correr
confiar_ca_windows.bat en ninguna PC — la CA ya es de confianza.

IMPORTANTE: ca_key.pem es la clave privada de la CA — quien la tenga puede
emitir certificados en los que confían todas las PCs de la oficina. No la
copies a otras PCs ni la compartas; solo bridge_cert.pem/bridge_key.pem
(el certificado ya emitido) se distribuye.
"""
import datetime
import ipaddress
import sys
from pathlib import Path

try:
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID
except ImportError:
    print("Falta instalar 'cryptography'. Corré (con Python 3.12):")
    print("  .venv_bridge\\Scripts\\pip install -r requirements-scanner-bridge.txt")
    sys.exit(1)

CARPETA = Path(__file__).parent
IPS_PATH = CARPETA / "ips_permitidas.txt"
CA_CERT_PATH = CARPETA / "ca_cert.pem"
CA_KEY_PATH = CARPETA / "ca_key.pem"
BRIDGE_CERT_PATH = CARPETA / "bridge_cert.pem"
BRIDGE_KEY_PATH = CARPETA / "bridge_key.pem"

VALIDEZ_CA = datetime.timedelta(days=3650)      # 10 años
VALIDEZ_BRIDGE = datetime.timedelta(days=3650)  # 10 años


def _leer_ips() -> list[str]:
    if not IPS_PATH.exists():
        IPS_PATH.write_text(
            "# Una IP por línea: todas las PCs de la oficina que puedan\n"
            "# llegar a tener el escáner conectado alguna vez.\n"
            "# Las líneas que empiezan con # se ignoran.\n"
            "192.168.0.253\n"
            "192.168.0.178\n",
            encoding="utf-8",
        )
        print(f"Creé {IPS_PATH.name} con IPs de ejemplo — revisalo y corré de nuevo.")
        sys.exit(0)
    ips = []
    for linea in IPS_PATH.read_text(encoding="utf-8").splitlines():
        linea = linea.strip()
        if not linea or linea.startswith("#"):
            continue
        try:
            ipaddress.ip_address(linea)
        except ValueError:
            print(f"  Aviso: '{linea}' en {IPS_PATH.name} no es una IP válida, se ignora.")
            continue
        ips.append(linea)
    if not ips:
        print(f"{IPS_PATH.name} no tiene ninguna IP válida cargada.")
        sys.exit(1)
    return ips


def _generar_clave() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _asegurar_ca() -> tuple[rsa.RSAPrivateKey, x509.Certificate]:
    if CA_CERT_PATH.exists() and CA_KEY_PATH.exists():
        clave_ca = serialization.load_pem_private_key(CA_KEY_PATH.read_bytes(), password=None)
        cert_ca = x509.load_pem_x509_certificate(CA_CERT_PATH.read_bytes())
        print(f"Usando CA existente ({CA_CERT_PATH.name}).")
        return clave_ca, cert_ca

    print("No hay CA todavía — creando una nueva (esto se hace una sola vez)...")
    clave_ca = _generar_clave()
    ahora = datetime.datetime.now(datetime.timezone.utc)
    nombre = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, "Depósito Delmy - CA Local (escáner)"),
    ])
    cert_ca = (
        x509.CertificateBuilder()
        .subject_name(nombre)
        .issuer_name(nombre)
        .public_key(clave_ca.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(ahora - datetime.timedelta(days=1))
        .not_valid_after(ahora + VALIDEZ_CA)
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=False, content_commitment=False, key_encipherment=False,
                data_encipherment=False, key_agreement=False, key_cert_sign=True,
                crl_sign=True, encipher_only=False, decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(clave_ca.public_key()), critical=False)
        .sign(clave_ca, hashes.SHA256())
    )
    CA_KEY_PATH.write_bytes(
        clave_ca.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    CA_CERT_PATH.write_bytes(cert_ca.public_bytes(serialization.Encoding.PEM))
    print(f"  CA creada: {CA_CERT_PATH.name} / {CA_KEY_PATH.name}")
    return clave_ca, cert_ca


def _generar_certificado_bridge(clave_ca: rsa.RSAPrivateKey, cert_ca: x509.Certificate, ips: list[str]):
    print(f"Generando certificado del bridge para: {', '.join(ips)} (+ 127.0.0.1, localhost)...")
    clave_bridge = _generar_clave()
    ahora = datetime.datetime.now(datetime.timezone.utc)
    nombre = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Bridge de escaneo - Depósito Delmy")])

    nombres_alternativos = [x509.DNSName("localhost")]
    ips_unicas = list(dict.fromkeys(ips + ["127.0.0.1"]))
    for ip in ips_unicas:
        nombres_alternativos.append(x509.IPAddress(ipaddress.ip_address(ip)))

    cert_bridge = (
        x509.CertificateBuilder()
        .subject_name(nombre)
        .issuer_name(cert_ca.subject)
        .public_key(clave_bridge.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(ahora - datetime.timedelta(days=1))
        .not_valid_after(ahora + VALIDEZ_BRIDGE)
        .add_extension(x509.SubjectAlternativeName(nombres_alternativos), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(x509.ExtendedKeyUsage([x509.oid.ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True, content_commitment=False, key_encipherment=True,
                data_encipherment=False, key_agreement=False, key_cert_sign=False,
                crl_sign=False, encipher_only=False, decipher_only=False,
            ),
            critical=True,
        )
        .sign(clave_ca, hashes.SHA256())
    )
    BRIDGE_KEY_PATH.write_bytes(
        clave_bridge.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    BRIDGE_CERT_PATH.write_bytes(cert_bridge.public_bytes(serialization.Encoding.PEM))
    print(f"  Listo: {BRIDGE_CERT_PATH.name} / {BRIDGE_KEY_PATH.name}")


def main():
    ips = _leer_ips()
    clave_ca, cert_ca = _asegurar_ca()
    _generar_certificado_bridge(clave_ca, cert_ca, ips)
    print()
    print("Siguiente paso:")
    print(f"  - Copiá {BRIDGE_CERT_PATH.name}, {BRIDGE_KEY_PATH.name} y scanner_bridge.py")
    print("    a cada PC que vaya a correr el bridge (reemplazando lo que haya).")
    print(f"  - En CADA PC de la oficina (solo una vez, para siempre), corré")
    print("    confiar_ca_windows.bat como administrador.")
    print(f"  - NO copies {CA_KEY_PATH.name} a ninguna otra PC.")


if __name__ == "__main__":
    main()
