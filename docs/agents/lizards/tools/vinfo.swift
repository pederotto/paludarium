// Prints duration, size, fps of videos: swift vinfo.swift <video>...
import AVFoundation
for p in CommandLine.arguments.dropFirst() {
  let a = AVURLAsset(url: URL(fileURLWithPath: p))
  let t = a.tracks(withMediaType: .video).first
  let s = t?.naturalSize ?? .zero
  print((p as NSString).lastPathComponent, String(format: "%.2f s", CMTimeGetSeconds(a.duration)), Int(s.width), "x", Int(s.height), "fps", t?.nominalFrameRate ?? 0, "frames~", Int(CMTimeGetSeconds(a.duration) * Double(t?.nominalFrameRate ?? 0)))
}
