import 'package:buzz/shared/widgets/cybota_mark.dart';
import 'package:buzz/shared/widgets/tappable_cybota_mark.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

void main() {
  testWidgets('CybotaMark paints a square of the requested size', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Center(child: CybotaMark(size: 80, color: Colors.black)),
      ),
    );
    final paint = tester.widget<CustomPaint>(
      find.descendant(
        of: find.byType(CybotaMark),
        matching: find.byType(CustomPaint),
      ),
    );
    expect(paint.size, const Size(80, 80));
  });

  testWidgets('tapping the welcome mark spins it once and then rests', (
    tester,
  ) async {
    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(
          home: Center(
            child: TappableCybotaMark(size: 80, color: Colors.black),
          ),
        ),
      ),
    );
    expect(tester.widget<CybotaMark>(find.byType(CybotaMark)).spin, 0);
    await tester.tap(find.byType(TappableCybotaMark));
    // A zero-duration pump locks in the AnimationController ticker's start
    // time before the fake clock advances; without it, the ticker's first
    // tick lands on the already-advanced clock and reports elapsed 0
    // regardless of the duration passed to the next pump (verified against
    // this Flutter SDK's AutomatedTestWidgetsFlutterBinding.pump, which
    // elapses the clock before running the frame).
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 450));
    final midSpin = tester.widget<CybotaMark>(find.byType(CybotaMark)).spin;
    expect(midSpin, greaterThan(0));
    expect(midSpin, lessThan(1));
    await tester.pumpAndSettle();
    expect(tester.widget<CybotaMark>(find.byType(CybotaMark)).spin, 1);
  });

  testWidgets('welcome mark carries a Cybota label, not a bee', (tester) async {
    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(
          home: Center(
            child: TappableCybotaMark(size: 80, color: Colors.black),
          ),
        ),
      ),
    );
    expect(find.bySemanticsLabel('Cybota mark'), findsOneWidget);
  });
}
