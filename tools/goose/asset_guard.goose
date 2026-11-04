import std;
import os;

fn check(path: const u8[:]) {
    var bytes: u8[>..] = [];
    guard read_file(path, bytes) else { print("missing asset: ", path); exit(1); }
    guard bytes.len > 0 else { print("empty asset: ", path); exit(1); }
    print("verified ", path, " (", bytes.len, " bytes)");
}

fn main() {
    check("multiplatform/composeApp/src/androidMain/assets/engine/engine.js");
    check("multiplatform/composeApp/src/androidMain/assets/demos.json");
    check("multiplatform/composeApp/src/wasmJsMain/resources/host.js");
}
