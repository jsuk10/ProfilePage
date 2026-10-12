/*
	Hyperspace by HTML5 UP
	html5up.net | @ajlkn
	Free for personal and commercial use under the CCA 3.0 license (html5up.net/license)

	Modified: 섹션 HTML 은 assets/js/portfolio/app.js 가 content/ 파일로 그립니다.
	그래서 섹션에 붙는 인터랙션은 그리기가 끝났다는 'portfolio:rendered' 이벤트 뒤에 붙입니다.
*/

(function($) {

	var	$window = $(window),
		$body = $('body'),
		$sidebar = $('#sidebar'),
		reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)'),
		barMode = window.matchMedia('(max-width: 1400px)');

	// Breakpoints.
		breakpoints({
			xlarge:   [ '1281px',  '1680px' ],
			large:    [ '981px',   '1280px' ],
			medium:   [ '737px',   '980px'  ],
			small:    [ '481px',   '736px'  ],
			xsmall:   [ null,      '480px'  ]
		});

	// Hack: Enable IE flexbox workarounds.
		if (browser.name == 'ie')
			$body.addClass('is-ie');

	// Forms.

		// Hack: Activate non-input submits.
			$('form').on('click', '.submit', function(event) {

				// Stop propagation, default.
					event.stopPropagation();
					event.preventDefault();

				// Submit form.
					$(this).parents('form').submit();

			});

	// Sidebar (top bar mode): keep the active link visible in the horizontally scrolling menu.
		function revealNavLink(link) {

			var	list = link.closest('ul'),
				listRect, linkRect;

			if (!barMode.matches || !list || list.scrollWidth <= list.clientWidth)
				return;

			listRect = list.getBoundingClientRect();
			linkRect = link.getBoundingClientRect();

			list.scrollBy({
				left: (linkRect.left + linkRect.width / 2) - (listRect.left + listRect.width / 2),
				behavior: reduceMotion.matches ? 'auto' : 'smooth'
			});

		}

	// Everything below needs the rendered sections.
		$(document).one('portfolio:rendered', function() {

			// Sidebar.
				if ($sidebar.length > 0) {

					var $sidebar_a = $sidebar.find('a');

					$sidebar_a
						.addClass('scrolly')
						.on('click', function() {

							var $this = $(this);

							// External link? Bail.
								if ($this.attr('href').charAt(0) != '#')
									return;

							// Deactivate all links.
								$sidebar_a.removeClass('active');

							// Activate link *and* lock it (so Scrollex doesn't try to activate other links as we're scrolling to this one's section).
								$this
									.addClass('active')
									.addClass('active-locked');

							revealNavLink(this);

						})
						.each(function() {

							var	$this = $(this),
								id = $this.attr('href'),
								$section = $(id);

							// No section for this link? Bail.
								if ($section.length < 1)
									return;

							// Scrollex.
								$section.scrollex({
									mode: 'middle',
									top: '-20vh',
									bottom: '-20vh',
									initialize: function() {

										// Deactivate section.
											$section.addClass('inactive');

									},
									enter: function() {

										// Activate section.
											$section.removeClass('inactive');

										// No locked links? Deactivate all links and activate this section's one.
											if ($sidebar_a.filter('.active-locked').length == 0) {

												$sidebar_a.removeClass('active');
												$this.addClass('active');
												revealNavLink($this[0]);

											}

										// Otherwise, if this section's link is the one that's locked, unlock it.
											else if ($this.hasClass('active-locked'))
												$this.removeClass('active-locked');

									}
								});

						});

				}

			// Scrolly.
				$('.scrolly').scrolly({
					speed: reduceMotion.matches ? 0 : 1000,
					offset: function() {

						// Sidebar is a top bar (<=1400px, see assets/css/portfolio.css)? Use its height as the offset.
							if (barMode.matches && $sidebar.length > 0)
								return $sidebar.outerHeight();

						return 0;

					}
				});

			// Spotlights.
				$('.spotlights > section')
					.scrollex({
						mode: 'middle',
						top: '-10vh',
						bottom: '-10vh',
						initialize: function() {

							// Deactivate section.
								$(this).addClass('inactive');

						},
						enter: function() {

							// Activate section.
								$(this).removeClass('inactive');

						}
					})
					.each(function() {

						var	$this = $(this),
							$image = $this.find('.image'),
							$img = $image.find('img'),
							x;

						// Assign image.
							$image.css('background-image', 'url("' + $img.attr('src') + '")');

						// Set background position.
							if (x = $img.data('position'))
								$image.css('background-position', x);

						// Hide <img>.
							$img.hide();

					});

			// Features.
				$('.features')
					.scrollex({
						mode: 'middle',
						top: '-20vh',
						bottom: '-20vh',
						initialize: function() {

							// Deactivate section.
								$(this).addClass('inactive');

						},
						enter: function() {

							// Activate section.
								$(this).removeClass('inactive');

						}
					});

			// Impact: each before / after chart animates when it reaches the middle of the screen.
				$('.pf-case')
					.scrollex({
						mode: 'middle',
						top: '-20vh',
						bottom: '-20vh',
						initialize: function() {

							// Deactivate case.
								$(this).addClass('inactive');

						},
						enter: function() {

							// Activate case.
								$(this).removeClass('inactive');

						}
					});

			// Play initial animations, then evaluate what is already on screen.
			// (Scrollex only checks on scroll, and window 'load' may have fired before the content arrived.)
				window.setTimeout(function() {
					$body.removeClass('is-preload');
					$window.trigger('scroll');
				}, 100);

		});

})(jQuery);
