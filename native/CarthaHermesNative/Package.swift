// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CarthaHermesNative",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "CarthaHermesNative", targets: ["CarthaHermesNative"])
    ],
    targets: [
        .executableTarget(name: "CarthaHermesNative")
    ]
)
