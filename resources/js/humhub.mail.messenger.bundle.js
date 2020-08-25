humhub.module('mail.ConversationView', function (module, require, $) {

    var Widget = require('ui.widget').Widget;
    var loader = require('ui.loader');
    var client = require('client');
    var additions = require('ui.additions');
    var object = require('util.object');
    var mail = require('mail.notification');

    var ConversationView = Widget.extend();

    ConversationView.prototype.init = function () {
        additions.observe(this.$);

        var that = this;
        window.onresize = function (evt) {
            that.updateSize();
        };

        if (!this.getActiveMessageId()) {
            this.setActiveMessageId(Widget.instance('#inbox').getFirstMessageId());
        }

        this.reload();

        this.$.on('mouseenter', '.mail-conversation-entry', function () {
            $(this).find('.conversation-menu').fadeIn('fast');
        }).on('mouseleave', '.mail-conversation-entry', function () {
            $(this).find('.conversation-menu').hide();
        });
    };

    ConversationView.prototype.loader = function (load) {
    debugger;
        if (load !== false) {
            loader.set(this.$);
        } else {
            loader.reset(this.$);
        }
    };

    ConversationView.prototype.markSeen = function (id) {
        client.post(this.options.markSeenUrl, {data: {id: id}}).then(function (response) {
            if (object.isDefined(response.messageCount)) {
                mail.setMailMessageCount(response.messageCount);
            }
        }).catch(function (e) {
            module.log.error(e);
        });
    };

    ConversationView.prototype.loadUpdate = function () {
        var $lastEntry = this.$.find('.mail-conversation-entry:last');
        var lastEntryId = $lastEntry.data('entry-id');
        var data = {id: this.getActiveMessageId(), from: lastEntryId};

        var that = this;
        client.get(this.options.loadUpdateUrl, {data: data}).then(function (response) {
            if (response.html) {
                $(response.html).each(function () {
                    that.appendEntry($(this));
                });
            }
        })
    };

    ConversationView.prototype.reply = function (evt) {
        var that = this;
        client.submit(evt).then(function (response) {
            if (response.success) {
                that.appendEntry(response.content).then(function() {
                    that.$.find(".time").timeago(); // somehow this is not triggered after reply
                    Widget.instance($('#replyform-message').trigger('clear')).focus();
                    that.scrollToBottom();
                    that.focus();
                    Widget.instance('#inbox').updateEntries([that.getActiveMessageId()]);
                    that.setLivePollInterval();
                });
            } else {
                module.log.error(response, true);
            }
        }).catch(function (e) {
            module.log.error(e, true);
        });
    };

    ConversationView.prototype.setLivePollInterval = function () {
        debugger;
        require('live').setDelay(5);
    };


    ConversationView.prototype.focus = function (evt) {
        Widget.instance('#replyform-message').focus();
    };

    ConversationView.prototype.canLoadMore = function () {
        return true;
        return !this.options.isLast;
    };

    ConversationView.prototype.reload = function () {
    debugger;
        if (this.getActiveMessageId()) {
            this.loadMessage(this.getActiveMessageId());
        }
    };

    ConversationView.prototype.addUser = function (evt) {
        var that = this;

        client.submit(evt).then(function (response) {
            if (response.result) {
                that.$.find('#mail-conversation-header').html(response.result);
            } else if (response.error) {
                module.log.error(response, true);
            }
        }).catch(function (e) {
            module.log.error(e, true);
        });
    };

    ConversationView.prototype.appendEntry = function (html) {
        var that = this;
        var $html = $(html);

        if (that.$.find('[data-entry-id="' + $html.data('entryId') + '"]').length) {
            return Promise.resolve();
        }

        // Filter out all script/links and text nodes
        var $elements = $html.not('script, link').filter(function () {
            return this.nodeType === 1; // filter out text nodes
        });

        // We use opacity because some additions require the actual size of the elements.
        $elements.css('opacity', 0);

        // call insert callback
        this.getListNode().append($html);

        return new Promise(function(resolve, reject) {
            $elements.hide().imagesLoaded(function() {
                $elements.css('opacity', 1).fadeIn('fast', function () {
                    that.onUpdate();
                    setTimeout(function() {that.scrollToBottom()}, 100);
                    resolve();
                });
            })
        })
    };

    ConversationView.prototype.loadMessage = function (evt) {
        var messageId = object.isNumber(evt) ? evt : evt.$trigger.data('message-id');
        var that = this;
        this.loader();
        client.get(this.options.loadMessageUrl, {data: {id: messageId}}).then(function (response) {
            that.setActiveMessageId(messageId);
            that.options.isLast = false;

            Widget.instance('#inbox').updateActiveItem();

            // Replace history state only if triggered by message preview item
            if (evt.$trigger && history && history.replaceState) {
                var url = evt.$trigger.data('action-url');
                if (url) {
                    history.replaceState(null, null, url);
                }
            }

            that.$.css('visibility', 'hidden');
            return that.updateContent(response.html);
        }).then(function () {
            return that.initScroll();
        }).catch(function (e) {
            module.log.error(e, true);
        }).finally(function () {
            that.loader(false);
            that.$.css('visibility', 'visible');
            that.initReplyRichText();
        });
    };

    ConversationView.prototype.initReplyRichText = function () {
        var that = this;
        that.focus();
        $('#replyform-message').on('keyup', function (evt) {
            if (evt.which === 13) {
                window.scrollTo(0, document.body.scrollHeight);
            }
        })
    };

    ConversationView.prototype.initScroll = function () {
        if (window.IntersectionObserver) {
            var $entryList = this.$.find('.conversation-entry-list');
            var $streamEnd = $('<div class="stream-end"></div>');
            $entryList.prepend($streamEnd);

            var that = this;
            var observer = new IntersectionObserver(function (entries) {
                if (that.preventScrollLoading()) {
                    return;
                }

                if (entries.length && entries[0].isIntersecting) {
                    loader.prepend($entryList);
                    that.loadMore().finally(function () {
                        loader.reset($entryList);
                    });
                }

            }, {root: $entryList[0], rootMargin: "50px"});

            // Assure the conversation list is scrollable by loading more entries until overflow
            return this.assureScroll().then(function () {
                observer.observe($streamEnd[0]);
                that.getListNode().niceScroll({
                    cursorwidth: "7",
                    cursorborder: "",
                    cursorcolor: "#555",
                    cursoropacitymax: "0.2",
                    nativeparentscrolling: false,
                    railpadding: {top: 0, right: 0, left: 0, bottom: 0}
                });
            });
        }
    };

    ConversationView.prototype.loadMore = function () {
        var that = this;

        var data = {
            id: this.getActiveMessageId(),
            from: this.$.find('.mail-conversation-entry:first').data('entryId')
        };

        return client.get(this.options.loadMoreUrl, {data: data}).then(function (response) {
            if (response.result) {
                var $result = $(response.result).hide();
                that.$.find('.conversation-entry-list').find('.stream-end').after($result);
                $result.fadeIn();
            }

            that.options.isLast = !response.result || response.isLast;
        }).catch(function (err) {
            module.log.error(err, true);
        });
    };

    ConversationView.prototype.preventScrollLoading = function () {
        return this.scrollLock || !this.canLoadMore();
    };

    ConversationView.prototype.canLoadMore = function () {
        return !this.options.isLast;
    };

    ConversationView.prototype.assureScroll = function () {
        var that = this;
        var $entryList = this.$.find('.conversation-entry-list');
        if ($entryList[0].offsetHeight >= $entryList[0].scrollHeight && this.canLoadMore()) {
            return this.loadMore().then(function () {
                return that.assureScroll();
            }).catch(function () {
                return Promise.resolve();
            })
        }

        return that.scrollToBottom();
    };

    ConversationView.prototype.updateContent = function (html) {
        var that = this;
        return new Promise(function (resolve) {
            that.$.html(html);
            resolve();
        });
    };


    ConversationView.prototype.getActiveMessageId = function () {
        return this.options.messageId;
    };

    ConversationView.prototype.setActiveMessageId = function (id) {
        this.options.messageId = id;
    };

    ConversationView.prototype.scrollToBottom = function () {
        var that = this;
        return new Promise(function (resolve) {
            var $list = that.getListNode();
            that.updateSize().then(function () {
                $list[0].scrollTop = $list[0].scrollHeight;
                resolve()
            });
        });
    };

    ConversationView.prototype.updateSize = function () {
        var that = this;
        return new Promise(function (resolve) {
            setTimeout(function () {
                if (!$('.conversation-entry-list').length) {
                    return;
                }

                var formHeight = $('.mail-message-form').height();
                var max_height = (window.innerHeight - that.$.position().top - formHeight - 160) + 'px';
                that.$.find('.conversation-entry-list').css('max-height', max_height);
                resolve();
            }, 100);
        })

    };

    ConversationView.prototype.getListNode = function () {
        return this.$.find('.conversation-entry-list');
    };

    ConversationView.prototype.onUpdate = function () {
        this.getListNode().getNiceScroll().resize();
    };

    module.export = ConversationView;
});
humhub.module('mail.ConversationEntry', function (module, require, $) {

    var Widget = require('ui.widget').Widget;

    var ConversationEntry = Widget.extend();

    ConversationEntry.prototype.replace = function (dom) {
        var that = this;
        var $content = $(dom).hide();
        this.$.fadeOut(function () {
            $(this).replaceWith($content);
            that.$ = $content;
            that.$.fadeIn('slow');
        });
    };

    ConversationEntry.prototype.remove = function () {
        this.$.fadeToggle('slow', function () {
            $(this).remove();
        });
    };

    module.export = ConversationEntry;
});
humhub.module('mail.inbox', function (module, require, $) {

    var Widget = require('ui.widget').Widget;
    var Filter = require('ui.filter').Filter;
    var view = require('ui.view');
    var loader = require('ui.loader');
    var client = require('client');

    var ConversationFilter = Filter.extend();

    ConversationFilter.prototype.triggerChange = function() {
        this.super('triggerChange');
        this.updateFilterCount();
    };

    ConversationFilter.prototype.updateFilterCount = function () {
        var count = this.getActiveFilterCount();

        var $filterToggle = this.$.find('#conversation-filter-link');
        var $filterCount = $filterToggle.find('.filterCount');

        if(count) {
            if(!$filterCount.length) {
                $filterCount = $('<small class="filterCount"></small>').insertBefore($filterToggle.find('.caret'));
            }
            $filterCount.html(' <b>('+count+')</b> ');
        } else if($filterCount.length) {
            $filterCount.remove();
        }
    };

    var ConversationList = Widget.extend();

    ConversationList.prototype.init = function () {
        this.filter = Widget.instance('#mail-filter-root');

        this.initScroll();

        var that = this;
        this.filter.off('afterChange.inbox').on('afterChange.inbox', function () {
            that.reload().then(function() {
                that.updateActiveItem();
            });
        });

        if(view.isLarge()) {
            this.$.niceScroll({
                cursorwidth: "7",
                cursorborder: "",
                cursorcolor: "#555",
                cursoropacitymax: "0.2",
                nativeparentscrolling: false,
                railpadding: {top: 0, right: 3, left: 0, bottom: 0}
            });
        }
    };

    ConversationList.prototype.updateEntries = function(ids) {
        var that = this;
        client.get(this.options.updateEntriesUrl, {data: {ids: ids}}).then(function(response) {
            if(!response.result)  {
                return;
            }

            $.each(response.result, function(id, html) {
                that.$.find('[data-message-preview="'+id+'"]').replaceWith(html);
            });

            that.updateActiveItem();
        }).catch(function(e) {
            module.log.error(e);
        });
    };

    ConversationList.prototype.initScroll = function() {
        if (window.IntersectionObserver) {

            var $streamEnd = $('<div class="stream-end"></div>');
            this.$.append($streamEnd);

            var that = this;
            var observer = new IntersectionObserver(function (entries) {
                if (that.preventScrollLoading()) {
                    return;
                }

                if (entries.length && entries[0].isIntersecting) {
                    loader.append(that.$);
                    that.loadMore().finally(function() {
                        loader.reset(that.$);
                    });
                }

            }, {root: this.$[0], rootMargin: "50px"});

            // Assure the conversation list is scrollable by loading more entries until overflow
            this.assureScroll().then(function() {
                observer.observe($streamEnd[0]);
            });
        }
    };

    ConversationList.prototype.assureScroll = function () {
        var that = this;

        if(this.$[0].offsetHeight >= this.$[0].scrollHeight && this.canLoadMore()) {
            return this.loadMore().then(function() {
                return that.assureScroll();
            }).catch(function () {
                return Promise.resolve();
            })
        }

        return Promise.resolve();
    };

    ConversationList.prototype.loadMore = function () {
        var that = this;
        return new Promise(function(resolve, reject) {
            var data = that.filter.getFilterMap();
            data.from = that.getLastMessageId();
            client.get(that.options.loadMoreUrl, {data: data}).then(function(response) {
                if(response.result) {
                    $(response.result).insertBefore('.stream-end');
                    that.$.find('.stream-end').append();
                }

                that.options.isLast = !response.result || response.isLast;
                that.updateActiveItem();

                resolve();
            }).catch(function(err) {
                module.log.error(err, true);
                reject();
            }).finally(function() {
                that.scrollLock = false;
            });
        });

    };

    ConversationList.prototype.preventScrollLoading = function () {
        return this.scrollLock || !this.canLoadMore();
    };

    ConversationList.prototype.canLoadMore = function () {
        return !this.options.isLast;
    };

    ConversationList.prototype.getReloadOptions = function () {
        return {data: this.filter.getFilterMap()};
    };

    ConversationList.prototype.updateActiveItem = function() {

        var activeMessageId = Widget.instance('#mail-conversation-root').getActiveMessageId();

        this.$.find('.entry').removeClass('selected');

        // Remove New badge from current selection
        this.$.find('.entry.selected').find('.new-message-badge').hide();

        // Set new selection
        this.$.find('.entry').removeClass('selected');
        var $selected = this.$.find('[data-message-preview="' + activeMessageId + '"]');

        if($selected.length) {
            $selected.addClass('selected').find('.new-message-badge').hide();
        }
    };


    ConversationList.prototype.getFirstMessageId = function() {
        return this.$.find('.entry:first').data('messagePreview');
    };

    ConversationList.prototype.getLastMessageId = function() {
        return this.$.find('.entry:last').data('messagePreview');
    };

    var setTagFilter = function (evt) {
        $('#mail-filter-menu').collapse('show');
        Widget.instance('#inbox-tag-picker').setSelection([{
            id: evt.$trigger.data('tagId'),
            text: evt.$trigger.data('tagName'),
            image: evt.$trigger.data('tagImage'),
        }]);
    };

    module.export({
        ConversationList: ConversationList,
        Filter: ConversationFilter,
        setTagFilter: setTagFilter
    });
});
humhub.module('mail.conversation', function (module, require, $) {

    var Widget = require('ui.widget').Widget;
    var modal = require('ui.modal');
    var client = require('client');
    var event = require('event');
    var mail = require('mail.notification');
    var user = require('user');

    var submitEditEntry = function (evt) {
        modal.submit(evt).then(function (response) {
            if (response.success) {
                var entry = getEntry(evt.$trigger.data('entry-id'));
                if (entry) {
                    setTimeout(function () {
                        entry.replace(response.content);
                    }, 300)
                }

                return;
            }

            module.log.error(null, true);
        }).catch(function (e) {
            module.log.error(e, true);
        });
    };

    var deleteEntry = function (evt) {
        var entry = getEntry(evt.$trigger.data('entry-id'));

        if (!entry) {
            module.log.error(null, true);
            return;
        }

        client.post(entry.options.deleteUrl).then(function (response) {
            modal.global.close();

            if (response.success) {
                setTimeout(function () {
                    entry.remove();
                }, 1000);
            }
        }).catch(function (e) {
            module.log.error(e, true);
        });
    };

    var getEntry = function (id) {
        return Widget.instance('.mail-conversation-entry[data-entry-id="' + id + '"]');
    };

    var getRootView = function () {
        return Widget.instance('#mail-conversation-root');
    };

    var init = function () {
        event.on('humhub:modules:mail:live:NewUserMessage', function (evt, events, update) {
            var root = getRootView();
            var updated = false;
            var updatedMessages = [];
            events.forEach(function (event) {
                var isOwn = event.data.guid == user.guid;
                updatedMessages.push(event.data.message_id);
                if (!isOwn && !updated && root && root.options.messageId == event.data.message_id) {
                    root.loadUpdate();
                    updated = true;
                    root.markSeen(event.data.message_id);
                } else if (!isOwn && root) {
                    getOverViewEntry(event.data.message_id).find('.new-message-badge').show();
                    // messageIds[event.data.message_id] = messageIds[event.data.message_id] ? messageIds[event.data.message_id] ++ : 1;
                }
                mail.setMailMessageCount(event.data.count);
            });

            Widget.instance('#inbox').updateEntries(updatedMessages);

        }).on('humhub:modules:mail:live:UserMessageDeleted', function (evt, events, update) {
            events.forEach(function (event) {
                var entry = getEntry(event.data.entry_id);
                if (entry) {
                    entry.remove();
                }
                mail.setMailMessageCount(event.data.count);
            });
        });
    };

    var getOverViewEntry = function (id) {
        return $('#mail-conversation-overview').find('[data-message-preview="' + id + '"]');
    };

    var leave = function (evt) {
        client.post(evt).then(function (response) {
            if (response.redirect) {
                client.pjax.redirect(response.redirect);
            }
        }).catch(function (e) {
            module.log.error(e, true);
        });
    };

    module.export({
        init: init,
        leave: leave,
        submitEditEntry: submitEditEntry,
        deleteEntry: deleteEntry,
    });
});