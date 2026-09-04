import 'dart:math' show min, pi;

import 'package:flutter/material.dart';

/// The Cybota mark: two grey outer arcs, two red inner arcs, a ring and a
/// shield. Geometry traced from the 1024px app icon
/// (`assets/images/cybercare-icon-source-1024.png`) in unit coordinates, so
/// it is crisp at any size and needs no asset.
///
/// [spin] turns the arcs — 0..1 is one full revolution, outer arcs clockwise,
/// inner arcs counter-clockwise; the ring and shield never move. Callers
/// animate it for loading and tap-to-spin; a resting mark is spin 0.
class CybotaMark extends StatelessWidget {
  /// Rendered width and height.
  final double size;

  /// Colour of the ring — the part that must read on the current surface.
  /// The arcs and shield keep the brand grey and red.
  final Color color;

  /// Arc rotation, 0..1 = one revolution.
  final double spin;

  const CybotaMark({
    required this.size,
    required this.color,
    this.spin = 0,
    super.key,
  });

  static const grey = Color(0xFF6B6B6B);
  static const red = Color(0xFFE5242B);

  @override
  Widget build(BuildContext context) {
    return RepaintBoundary(
      child: CustomPaint(
        size: Size.square(size),
        painter: _CybotaMarkPainter(color: color, spin: spin),
      ),
    );
  }
}

class _CybotaMarkPainter extends CustomPainter {
  final Color color;
  final double spin;

  const _CybotaMarkPainter({required this.color, required this.spin});

  static double _rad(double degrees) => degrees * pi / 180;

  void _arc(
    Canvas canvas,
    Offset centre,
    double radius,
    double stroke,
    double startDegrees,
    double sweepDegrees,
    double rotation,
    Color arcColor,
  ) {
    final paint = Paint()
      ..color = arcColor
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..strokeCap = StrokeCap.round;
    canvas.drawArc(
      Rect.fromCircle(center: centre, radius: radius),
      _rad(startDegrees) + rotation,
      _rad(sweepDegrees),
      false,
      paint,
    );
  }

  @override
  void paint(Canvas canvas, Size size) {
    final s = min(size.width, size.height);
    final centre = Offset(size.width / 2, size.height / 2);
    final outer = spin * 2 * pi;
    final inner = -spin * 2 * pi;

    // Angles are Flutter canvas degrees: 0 = 3 o'clock, clockwise positive.
    // These are the SAME numbers as desktop's CybotaMark.tsx (verified there
    // by rasterizing against the source icon) — the two clients must paint
    // an identical mark. Do not retune here.
    // Outer grey pair.
    _arc(canvas, centre, 0.43 * s, 0.085 * s, 100, 185, outer, CybotaMark.grey);
    _arc(canvas, centre, 0.43 * s, 0.085 * s, -33, 72, outer, CybotaMark.grey);
    // Inner red pair.
    _arc(canvas, centre, 0.31 * s, 0.075 * s, 185, 68, inner, CybotaMark.red);
    _arc(canvas, centre, 0.31 * s, 0.075 * s, 14, 132, inner, CybotaMark.red);
    // Ring.
    canvas.drawCircle(
      centre,
      0.18 * s,
      Paint()
        ..color = color
        ..style = PaintingStyle.stroke
        ..strokeWidth = 0.044 * s,
    );
    // Shield (desktop path, in a 100-unit box: corners at y 41, a small dip to
    // y 42.4 at the centre top, straight sides to y 50.5, curved to a point at
    // y 61). Same shape as desktop's SHIELD constant.
    double u(double v) => v / 100 * s; // 100-unit box -> rendered size
    final ox = centre.dx - u(50);
    final oy = centre.dy - u(50);
    final shield = Path()
      ..moveTo(ox + u(41.5), oy + u(41))
      ..lineTo(ox + u(50), oy + u(42.4))
      ..lineTo(ox + u(58.5), oy + u(41))
      ..lineTo(ox + u(58.5), oy + u(50.5))
      ..cubicTo(
        ox + u(58.5),
        oy + u(55.8),
        ox + u(54.8),
        oy + u(59.2),
        ox + u(50),
        oy + u(61),
      )
      ..cubicTo(
        ox + u(45.2),
        oy + u(59.2),
        ox + u(41.5),
        oy + u(55.8),
        ox + u(41.5),
        oy + u(50.5),
      )
      ..close();
    canvas.drawPath(shield, Paint()..color = CybotaMark.red);
  }

  @override
  bool shouldRepaint(_CybotaMarkPainter oldDelegate) =>
      color != oldDelegate.color || spin != oldDelegate.spin;
}
