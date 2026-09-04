import 'dart:async';

import 'package:buzz/shared/widgets/cybota_mark.dart';
import 'package:buzz/shared/widgets/mark_refresh_indicator.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../helpers/widget_helpers.dart';

void main() {
  testWidgets('shows the mark while pulling to refresh', (tester) async {
    const contentKey = ValueKey('loading-content');
    var refreshes = 0;
    final refreshCompleter = Completer<void>();

    await tester.pumpWidget(
      WidgetHelpers.testable(
        child: MarkRefreshIndicator(
          onRefresh: () {
            refreshes++;
            return refreshCompleter.future;
          },
          child: ListView(
            children: const [SizedBox(key: contentKey, height: 800)],
          ),
        ),
      ),
    );

    final listFinder = find.byType(ListView);
    final restingTop = tester.getTopLeft(listFinder).dy;
    final restingContentTop = tester.getTopLeft(find.byKey(contentKey)).dy;
    await tester.timedDrag(
      listFinder,
      const Offset(0, 320),
      const Duration(milliseconds: 500),
    );
    await tester.pump(const Duration(milliseconds: 16));
    await tester.pump(const Duration(milliseconds: 300));

    final markFinder = find.byType(CybotaMark);
    final loadingTop = tester.getTopLeft(listFinder).dy;
    final loadingContentTop = tester.getTopLeft(find.byKey(contentKey)).dy;
    final gapTransform = tester.widget<Transform>(
      find.byKey(const ValueKey('mark-refresh-retained-gap')),
    );
    expect(markFinder, findsOneWidget);
    expect(refreshes, 1);
    expect(gapTransform.transform.getTranslation().y, closeTo(72, 1));
    expect(loadingTop - restingTop, closeTo(72, 1));
    final loadingMarkRect = tester.getRect(markFinder);
    final loadingGap = loadingContentTop - restingContentTop;
    expect(
      loadingMarkRect.center.dy,
      closeTo(
        restingContentTop +
            (loadingGap - loadingMarkRect.height) * 0.75 +
            loadingMarkRect.height / 2,
        1,
      ),
    );

    refreshCompleter.complete();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 90));

    final closingTop = tester.getTopLeft(listFinder).dy;
    expect(closingTop, greaterThan(restingTop));
    expect(closingTop, lessThan(loadingTop));

    await tester.pumpAndSettle();
    expect(tester.getTopLeft(listFinder).dy, closeTo(restingTop, 1));
    expect(markFinder, findsNothing);
  });

  testWidgets('tracks each stage of an active pull', (tester) async {
    tester.view.physicalSize = const Size(420, 912);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final hapticCalls = <MethodCall>[];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, (call) async {
          if (call.method == 'HapticFeedback.vibrate') hapticCalls.add(call);
          return null;
        });
    addTearDown(
      () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, null),
    );

    const contentKey = ValueKey('pull-content');
    final refreshCompleter = Completer<void>();
    await tester.pumpWidget(
      WidgetHelpers.testable(
        child: MarkRefreshIndicator(
          onRefresh: () => refreshCompleter.future,
          child: ListView(
            children: const [SizedBox(key: contentKey, height: 800)],
          ),
        ),
      ),
    );

    final restingContentTop = tester.getTopLeft(find.byKey(contentKey)).dy;
    final gesture = await tester.startGesture(
      tester.getCenter(find.byType(ListView)),
      pointer: 1,
    );
    await gesture.moveBy(const Offset(0, 12));
    await tester.pump();

    // Below the 0.18 reveal threshold (12px of 100px trigger distance): the
    // mark stays unrendered.
    final markFinder = find.byType(CybotaMark);
    expect(markFinder, findsNothing);
    expect(
      tester.getTopLeft(find.byKey(contentKey)).dy,
      greaterThan(restingContentTop),
    );

    await gesture.moveBy(const Offset(0, 44));
    await tester.pump();

    final earlyTop = tester.getTopLeft(markFinder).dy;
    final partialOpacity = tester.widget<Opacity>(
      find.byKey(const ValueKey('mark-refresh-opacity')),
    );
    expect(partialOpacity.opacity, greaterThan(0));
    expect(partialOpacity.opacity, lessThan(1));
    final partialScale = tester
        .widget<Transform>(find.byKey(const ValueKey('mark-refresh-scale')))
        .transform
        .storage[0];
    expect(partialScale, greaterThan(0.6));
    expect(partialScale, lessThan(1));
    expect(hapticCalls, isEmpty);

    await gesture.moveBy(const Offset(0, 120));
    await tester.pump();

    // Past the 100px trigger distance: the arm haptic fires exactly once,
    // and the mark sits at the same 0.75 vertical alignment used while
    // loading.
    final pulledContentTop = tester.getTopLeft(find.byKey(contentKey)).dy;
    expect(tester.getTopLeft(markFinder).dy, greaterThan(earlyTop));
    final pulledMarkRect = tester.getRect(markFinder);
    final pulledGap = pulledContentTop - restingContentTop;
    expect(
      pulledMarkRect.center.dy,
      closeTo(
        restingContentTop +
            (pulledGap - pulledMarkRect.height) * 0.75 +
            pulledMarkRect.height / 2,
        1,
      ),
    );
    expect(hapticCalls, hasLength(1));
    expect(hapticCalls.single.arguments, 'HapticFeedbackType.mediumImpact');

    await gesture.moveBy(const Offset(0, 120));
    await tester.pump();

    expect(
      tester
          .widget<Transform>(find.byKey(const ValueKey('mark-refresh-scale')))
          .transform
          .storage[0],
      closeTo(1, 0.001),
    );
    expect(hapticCalls, hasLength(1));

    await gesture.up();
    await tester.pump();
    final hapticsAfterRelease = hapticCalls.length;
    await tester.pump(const Duration(milliseconds: 300));

    expect(hapticCalls, hasLength(hapticsAfterRelease));

    refreshCompleter.complete();
    await tester.pumpAndSettle();
  });

  testWidgets(
    'does not arm-haptic from a ballistic overscroll after the finger lifts',
    (tester) async {
      final hapticCalls = <MethodCall>[];
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, (call) async {
            if (call.method == 'HapticFeedback.vibrate') {
              hapticCalls.add(call);
            }
            return null;
          });
      addTearDown(
        () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(SystemChannels.platform, null),
      );

      await tester.pumpWidget(
        WidgetHelpers.testable(
          child: MarkRefreshIndicator(
            onRefresh: () async {},
            child: ListView(children: const [SizedBox(height: 800)]),
          ),
        ),
      );

      // A short, fast flick: the drag itself only reaches 60px (well under
      // the 100px trigger), but a high release velocity leaves
      // BouncingScrollPhysics to keep carrying the scroll position past the
      // top edge on its own, well after the finger is gone. That ballistic
      // overscroll used to be able to cross the 100px trigger and fire the
      // arm haptic with no finger down and no pending refresh.
      await tester.fling(
        find.byType(ListView),
        const Offset(0, 60),
        4000,
      );
      await tester.pumpAndSettle();

      expect(hapticCalls, isEmpty);
    },
  );

  testWidgets('quick flick still refreshes once with one haptic', (
    tester,
  ) async {
    final hapticCalls = <MethodCall>[];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, (call) async {
          if (call.method == 'HapticFeedback.vibrate') hapticCalls.add(call);
          return null;
        });
    addTearDown(
      () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, null),
    );
    final refreshCompleter = Completer<void>();
    var refreshes = 0;
    await tester.pumpWidget(
      WidgetHelpers.testable(
        child: MarkRefreshIndicator(
          onRefresh: () {
            refreshes++;
            return refreshCompleter.future;
          },
          child: ListView(children: const [SizedBox(height: 800)]),
        ),
      ),
    );

    final gesture = await tester.startGesture(
      tester.getCenter(find.byType(ListView)),
    );
    for (var step = 0; step < 10; step++) {
      await gesture.moveBy(
        const Offset(0, 50),
        timeStamp: Duration(milliseconds: (step + 1) * 10),
      );
      await tester.pump(const Duration(milliseconds: 10));
    }

    await gesture.up();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    expect(refreshes, 1);
    expect(hapticCalls, hasLength(1));
    expect(hapticCalls.single.arguments, 'HapticFeedbackType.mediumImpact');

    refreshCompleter.complete();
    await tester.pumpAndSettle();
  });

  testWidgets('keeps the mark static when motion is disabled', (
    tester,
  ) async {
    await tester.pumpWidget(
      MediaQuery(
        data: const MediaQueryData(disableAnimations: true),
        child: WidgetHelpers.testable(
          child: Builder(
            builder: (context) => MediaQuery(
              data: MediaQuery.of(context).copyWith(disableAnimations: true),
              child: MarkRefreshIndicator(
                onRefresh: () async {},
                child: ListView(children: const [SizedBox(height: 800)]),
              ),
            ),
          ),
        ),
      ),
    );

    await tester.timedDrag(
      find.byType(ListView),
      const Offset(0, 160),
      const Duration(milliseconds: 400),
    );
    await tester.pump();

    final mark = tester.widget<CybotaMark>(find.byType(CybotaMark));
    expect(mark.spin, 0);
  });

  testWidgets('provides elastic always-scrollable physics', (tester) async {
    late ScrollPhysics physics;

    await tester.pumpWidget(
      WidgetHelpers.testable(
        child: MarkRefreshIndicator(
          onRefresh: () async {},
          child: Builder(
            builder: (context) {
              physics = ScrollConfiguration.of(
                context,
              ).getScrollPhysics(context);
              return ListView(children: const [SizedBox(height: 20)]);
            },
          ),
        ),
      ),
    );

    expect(physics, isA<BouncingScrollPhysics>());
    expect(physics.parent, isA<AlwaysScrollableScrollPhysics>());
  });
}
